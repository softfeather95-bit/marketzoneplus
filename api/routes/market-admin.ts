import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { COUNTRY_BY_NAME } from "@contracts/countries";
import { requireAdmin, cents, money, audit, notify, referralCode } from "../market/utils";
import { changeWallet, restoreOrderStock, returnSellerPrincipal } from "../market/order-utils";

export const marketAdminRoutes = new Hono();
const body = async (c: Context) => c.req.json().catch(() => null);
const id = z.coerce.number().int().positive();
const optionalText = (max: number) => z.string().trim().max(max).optional();

marketAdminRoutes.patch("/users/:id", async (c) => {
  const admin = await requireAdmin(c);
  const userId = id.safeParse(c.req.param("id"));
  const input = z.object({ status: z.enum(["active", "banned"]).optional(), withdrawHold: z.boolean().optional() }).refine((v) => Object.keys(v).length > 0).safeParse(await body(c));
  if (!userId.success || !input.success) return c.json({ error: "Invalid member update." }, 400);
  if (userId.data === admin.id && input.data.status === "banned") return c.json({ error: "You cannot ban your own administrator account." }, 409);
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId.data) });
  if (!user) return c.json({ error: "Member not found." }, 404);
  const previous = { status: user.status, withdrawHold: user.withdrawHold };
  await db.update(schema.users).set(input.data).where(eq(schema.users.id, user.id));
  await audit(admin.id, "user", user.id, "member_updated", previous, input.data, "Administrator updated member access controls.");
  if (input.data.withdrawHold !== undefined && input.data.withdrawHold !== user.withdrawHold) {
    await notify(user.id, input.data.withdrawHold ? "Account frozen" : "Account unfrozen", input.data.withdrawHold ? "Your account is frozen by the administrator. Financial and Store actions are unavailable. Please contact the administrator." : "Your account is active again. Permitted financial and Store actions have been restored.");
  }
  return c.json({ ok: true });
});

marketAdminRoutes.post("/wallet", async (c) => {
  const admin = await requireAdmin(c);
  const input = z.object({ userId: id, amount: z.number().min(-1_000_000).max(1_000_000).refine((v) => v !== 0), reason: z.string().trim().min(3).max(500) }).safeParse(await body(c));
  if (!input.success) return c.json({ error: "Enter a non-zero adjustment and a reason." }, 400);
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, input.data.userId) });
  if (!user) return c.json({ error: "Member not found." }, 404);
  try {
    const balance = await db.transaction(async (tx) => {
      const amount = cents(input.data.amount);
      const wallet = await tx.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id)).for("update");
      const before = wallet[0]?.balanceCents || 0;
      const after = before + amount;
      if (after < 0) throw new Error("This adjustment would make the balance negative.");
      if (wallet[0]) await tx.update(schema.wallets).set({ balanceCents: after }).where(eq(schema.wallets.userId, user.id));
      else await tx.insert(schema.wallets).values({ userId: user.id, balanceCents: after });
      await tx.insert(schema.transactions).values({ userId: user.id, type: amount > 0 ? "credit" : "debit", amountCents: amount, note: `Administrator adjustment: ${input.data.reason}` });
      await audit(admin.id, "wallet", user.id, "balance_adjusted", { balance: money(before) }, { balance: money(after) }, input.data.reason, tx);
      await tx.insert(schema.notifications).values({ userId: user.id, title: "Wallet balance updated", message: `An authorized administrator adjusted your balance by $${money(amount).toFixed(2)}. Reason: ${input.data.reason}` });
      return after;
    });
    return c.json({ ok: true, balance: money(balance) });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Adjustment failed." }, 409); }
});

marketAdminRoutes.patch("/deposits/:id", async (c) => {
  const admin = await requireAdmin(c);
  const depositId = id.safeParse(c.req.param("id"));
  const input = z.object({ action: z.enum(["Approved", "Rejected"]), note: z.string().trim().max(500).optional().default("") }).safeParse(await body(c));
  if (!depositId.success || !input.success) return c.json({ error: "Invalid deposit review." }, 400);
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(schema.deposits).where(eq(schema.deposits.id, depositId.data)).for("update");
      const deposit = rows[0];
      if (!deposit || deposit.status !== "Pending") throw new Error("This deposit has already been processed.");
      await tx.update(schema.deposits).set({ status: input.data.action, processedBy: admin.id, processedAt: new Date() }).where(eq(schema.deposits.id, deposit.id));
      if (input.data.action === "Approved") {
        const wallet = await changeWallet(tx, deposit.userId, deposit.amountCents);
        await tx.insert(schema.transactions).values({ userId: deposit.userId, type: "credit", amountCents: deposit.amountCents, note: `Approved deposit request #${deposit.id}` });
        await audit(admin.id, "deposit", deposit.id, "approved", { status: deposit.status, balance: money(wallet.before) }, { status: "Approved", balance: money(wallet.after) }, input.data.note || "Deposit verified and approved by administrator.", tx);
      } else {
        await audit(admin.id, "deposit", deposit.id, "rejected", { status: deposit.status }, { status: "Rejected" }, input.data.note || "Deposit request rejected; no balance change.", tx);
      }
      await tx.insert(schema.notifications).values({ userId: deposit.userId, title: `Deposit request #${deposit.id} ${input.data.action.toLowerCase()}`, message: input.data.action === "Approved" ? `$${money(deposit.amountCents).toFixed(2)} was credited after administrator verification.` : "The request was rejected. Your balance was not changed." });
    });
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Deposit review failed." }, 409);
  }
});

marketAdminRoutes.patch("/stores/:id", async (c) => {
  const admin = await requireAdmin(c);
  const storeId = id.safeParse(c.req.param("id"));
  const input = z.object({
    status: z.enum(["pending", "approved", "rejected"]).optional(), rejectReason: z.string().trim().max(1000).optional(),
    creditScore: z.number().int().min(0).max(1000).optional(), rating: z.number().min(0).max(5).refine((v) => Math.round(v * 10) === v * 10).optional(),
    visitors: z.number().int().min(0).max(2_000_000_000).optional(), views: z.number().int().min(0).max(2_000_000_000).optional(),
    storeName: z.string().trim().min(3).max(180).optional(), category: z.string().trim().min(2).max(120).optional(), description: z.string().trim().min(20).max(5000).optional(),
    ownerName: optionalText(160), houseNumber: optionalText(40), street: optionalText(180), apartment: optionalText(80),
    city: optionalText(120), state: optionalText(120), zip: optionalText(30), officeCountry: optionalText(100),
  }).refine((v) => Object.keys(v).length > 0).safeParse(await body(c));
  if (!storeId.success || !input.success) return c.json({ error: "Invalid Store values. Check credit, rating, whole-number statistics, and office fields." }, 400);
  if (input.data.status === "rejected" && !input.data.rejectReason) return c.json({ error: "Provide a reason when rejecting a Store." }, 400);
  const db = getDb();
  const store = await db.query.stores.findFirst({ where: eq(schema.stores.id, storeId.data) });
  if (!store) return c.json({ error: "Store not found." }, 404);
  const { rating, ...storePatch } = input.data;
  const patch: Partial<typeof schema.stores.$inferInsert> = { ...storePatch };
  if (rating !== undefined) patch.rating = rating.toFixed(1);
  if (input.data.status) {
    patch.reviewedAt = new Date();
    if (input.data.status !== "rejected") patch.rejectReason = null;
  }
  if (["visitors", "views"].some((key) => input.data[key as "visitors" | "views"] !== undefined)) patch.metricsSource = "admin_configured";
  const previous = { status: store.status, creditScore: store.creditScore, rating: store.rating, visitors: store.visitors, views: store.views, ownerName: store.ownerName, houseNumber: store.houseNumber, street: store.street, apartment: store.apartment, city: store.city, state: store.state, zip: store.zip, officeCountry: store.officeCountry };
  await db.update(schema.stores).set(patch).where(eq(schema.stores.id, store.id));
  await audit(admin.id, "store", store.id, "store_updated", previous, patch, "Administrator updated protected Store settings or office information.");
  await notify(store.userId, "Store settings updated", `${store.storeName} was updated by an administrator. Manually configured visitors/views are not independently tracked analytics.`);
  return c.json({ ok: true });
});

marketAdminRoutes.post("/stores", async (c) => {
  const admin = await requireAdmin(c);
  const input = z.object({
    userId: id, storename: z.string().trim().min(3).max(180), storecat: z.string().trim().min(2).max(120), description: z.string().trim().min(20).max(5000),
    gender: z.enum(["Male", "Female"]), country: z.string().trim().min(2).max(100), phone: z.string().trim().min(1).max(35),
    doctype: z.string().trim().min(2).max(80), docdata: z.string().max(3_600_000).optional().default(""), refcode: z.string().trim().max(9).optional().default(""),
  }).safeParse(await body(c));
  if (!input.success) return c.json({ error: "Complete all required merchant fields, including gender and country." }, 400);
  const country = COUNTRY_BY_NAME.get(input.data.country);
  if (!country) return c.json({ error: "Select a valid country." }, 400);
  const db = getDb();
  const customer = await db.query.users.findFirst({ where: and(eq(schema.users.id, input.data.userId), eq(schema.users.role, "user")) });
  if (!customer) return c.json({ error: "Customer not found." }, 404);
  const existing = await db.query.stores.findFirst({ where: eq(schema.stores.userId, customer.id) });
  if (existing) return c.json({ error: "This customer already has a Store." }, 409);
  const [{ id: storeId }] = await db.insert(schema.stores).values({
    userId: customer.id, storeName: input.data.storename, category: input.data.storecat, description: input.data.description,
    gender: input.data.gender, country: country.name, dialingCode: country.dial, phone: input.data.phone,
    docType: input.data.doctype, docImage: input.data.docdata || null, refCode: input.data.refcode || null,
    status: "approved", creditScore: 100, rating: "5.0", visitors: 0, views: 0, productIds: [], reviewedAt: new Date(),
  }).$returningId();
  await audit(admin.id, "store", storeId, "created", null, { customerId: customer.id, storeName: input.data.storename, creditScore: 100, rating: "5.0", visitors: 0, views: 0 }, "Administrator created an approved merchant Store.");
  await notify(customer.id, "Store approved", `${input.data.storename} was created and approved by an administrator.`);
  return c.json({ ok: true, id: storeId }, 201);
});

marketAdminRoutes.delete("/stores/:id", async (c) => {
  const admin = await requireAdmin(c);
  const storeId = id.safeParse(c.req.param("id"));
  if (!storeId.success) return c.json({ error: "Invalid Store." }, 400);
  const db = getDb();
  const store = await db.query.stores.findFirst({ where: eq(schema.stores.id, storeId.data) });
  if (!store) return c.json({ error: "Store not found." }, 404);
  const linkedOrders = await db.select({ id: schema.sellerOrders.id }).from(schema.sellerOrders).where(eq(schema.sellerOrders.storeId, store.id)).limit(1);
  if (linkedOrders.length) return c.json({ error: "This Store has historical orders and cannot be deleted. Change its status instead." }, 409);
  await db.transaction(async (tx) => {
    await tx.update(schema.products).set({ storeId: null }).where(eq(schema.products.storeId, store.id));
    await tx.delete(schema.stores).where(eq(schema.stores.id, store.id));
    await audit(admin.id, "store", store.id, "deleted", { storeName: store.storeName }, null, "Store without order history was deleted.", tx);
  });
  return c.json({ ok: true });
});

marketAdminRoutes.post("/manual-orders", async (c) => {
  const admin = await requireAdmin(c);
  const input = z.object({ storeId: id, productId: id, quantity: z.number().int().min(1).max(100), amount: z.number().min(0.01).max(1_000_000), profit: z.number().min(0).max(1_000_000), eta: z.string().trim().min(2).max(60), instructions: z.string().trim().max(2000).optional().default("") }).safeParse(await body(c));
  if (!input.success) return c.json({ error: "Select an approved Store, an eligible Store product, valid quantity, order amount, profit, and completion estimate." }, 400);
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const storeRows = await tx.select().from(schema.stores).where(eq(schema.stores.id, input.data.storeId)).for("update");
      const store = storeRows[0];
      if (!store || store.status !== "approved") throw new Error("Select an approved Store.");
      const productRows = await tx.select().from(schema.products).where(eq(schema.products.id, input.data.productId)).for("update");
      const product = productRows[0];
      if (!product) throw new Error("Product not found.");
      const storeProductIds = Array.isArray(store.productIds) ? store.productIds.map(Number) : [];
      if (product.storeId !== store.id || !storeProductIds.includes(product.id)) {
        throw new Error("This product is not eligible. The Store owner must add it through Add to My Store before assignment.");
      }
      if (product.stock < input.data.quantity) throw new Error("Insufficient product stock for this manual order.");
      const total = cents(input.data.amount);
      const unitPrice = Math.round(total / input.data.quantity);
      const item = { productId: product.id, name: product.name, qty: input.data.quantity, price: money(unitPrice), mrp: money(product.mrpCents), discountPercent: product.discountPercent, commission: 0, storeId: store.id, storeName: store.storeName, image: product.image };
      const [{ id: orderId }] = await tx.insert(schema.orders).values({ userId: store.userId, manual: true, status: "Pending", totalCents: total, shippingCents: 0, paymentMethod: "Manual Order Assistance", address: "Administrator-arranged manual order", phone: store.phone, country: store.country, items: [item], createdBy: admin.id, idempotencyKey: null }).$returningId();
      const [{ id: sellerOrderId }] = await tx.insert(schema.sellerOrders).values({
        customerOrderId: orderId, storeId: store.id, sellerId: store.userId, productId: product.id, productName: product.name,
        productImage: product.image, quantity: input.data.quantity, amountCents: total, profitCents: cents(input.data.profit),
        status: "Awaiting Acceptance", eta: input.data.eta, instructions: input.data.instructions,
        history: [{ status: "Awaiting Acceptance", message: input.data.instructions, at: new Date().toISOString(), by: "admin" }],
      }).$returningId();
      await tx.update(schema.products).set({ stock: product.stock - input.data.quantity }).where(eq(schema.products.id, product.id));
      await tx.insert(schema.notifications).values({ userId: store.userId, title: `Manual order ORD-${sellerOrderId} assigned`, message: `${product.name} × ${input.data.quantity} requires $${money(total).toFixed(2)} for acceptance and offers $${cents(input.data.profit) / 100} profit. Review it in your Store workspace.`, soId: sellerOrderId });
      await audit(admin.id, "order", orderId, "manual_order_created", null, { orderId, sellerOrderId, customerId: store.userId, storeId: store.id, productId: product.id, quantity: input.data.quantity, total: money(total), profit: input.data.profit }, "Manual order with administrator-defined amount and profit linked to an eligible Store product.", tx);
      return { orderId, sellerOrderId };
    });
    return c.json({ ok: true, ...result }, 201);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Manual order could not be created. No duplicate was submitted." }, 409); }
});

marketAdminRoutes.patch("/orders/:id", async (c) => {
  const admin = await requireAdmin(c);
  const orderId = id.safeParse(c.req.param("id"));
  const input = z.object({ status: z.enum(["Pending", "Processing", "Shipped", "Completed", "Cancelled"]), message: z.string().trim().max(1000).optional().default("") }).safeParse(await body(c));
  if (!orderId.success || !input.success) return c.json({ error: "Invalid order status." }, 400);
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const orderRows = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId.data)).for("update");
      const order = orderRows[0];
      if (!order) throw new Error("Order not found.");
      if (order.status === "Cancelled") throw new Error("Cancelled orders are final and cannot be reopened.");
      if (order.status === input.data.status) return;
      await tx.update(schema.orders).set({ status: input.data.status, completedAt: input.data.status === "Completed" ? new Date() : null }).where(eq(schema.orders.id, order.id));
      if (input.data.status === "Cancelled") {
        await restoreOrderStock(tx, order);
        if (order.paymentMethod === "Wallet Balance" && !order.refundIssued) {
          await changeWallet(tx, order.userId, order.totalCents);
          await tx.insert(schema.transactions).values({ userId: order.userId, type: "refund", amountCents: order.totalCents, note: `Administrator refund for order #${order.id}`, orderId: order.id });
          await tx.update(schema.orders).set({ refundIssued: true }).where(eq(schema.orders.id, order.id));
        }
      }
      const sellerRows = await tx.select().from(schema.sellerOrders).where(eq(schema.sellerOrders.customerOrderId, order.id)).for("update");
      if (sellerRows[0]) throw new Error(`This order is linked to ORD-${sellerRows[0].id}. Manage it from Seller Orders so acceptance and wallet settlement cannot be bypassed.`);
      await tx.insert(schema.notifications).values({ userId: order.userId, title: `Order #${order.id} ${input.data.status}`, message: input.data.message || `Your order status is now ${input.data.status}.` });
      await audit(admin.id, "order", order.id, "status_changed", { status: order.status }, { status: input.data.status }, input.data.message || "Administrator updated order status.", tx);
    });
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Order status update failed." }, 409);
  }
});

marketAdminRoutes.patch("/seller-orders/:id", async (c) => {
  const admin = await requireAdmin(c);
  const sellerId = id.safeParse(c.req.param("id"));
  const input = z.object({
    status: z.enum(["Purchasing", "Preparing for Shipping", "Processing", "Ready for Shipping", "Shipped", "Out for Delivery", "Delivered", "Completed", "Cancelled"]).optional(),
    amount: z.number().min(0.01).max(1_000_000).optional(), profit: z.number().min(0).max(1_000_000).optional(),
    profitStatus: z.literal("Paid").optional(), message: z.string().trim().max(1000).optional().default(""),
  }).refine((v) => v.status !== undefined || v.amount !== undefined || v.profit !== undefined || v.profitStatus !== undefined).safeParse(await body(c));
  if (!sellerId.success || !input.success) return c.json({ error: "Provide a valid administrator status or pre-acceptance financial edit." }, 400);
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const sellerRows = await tx.select().from(schema.sellerOrders).where(eq(schema.sellerOrders.id, sellerId.data)).for("update");
      const order = sellerRows[0];
      if (!order) throw new Error("Seller order not found.");
      const customerRows = await tx.select().from(schema.orders).where(eq(schema.orders.id, order.customerOrderId)).for("update");
      const customerOrder = customerRows[0];
      if (!customerOrder) throw new Error("Linked customer order not found.");
      const financialEdit = input.data.amount !== undefined || input.data.profit !== undefined;
      if (financialEdit) {
        if (input.data.status !== undefined || input.data.profitStatus !== undefined) throw new Error("Save financial edits separately from status changes.");
        if (order.status !== "Awaiting Acceptance" || order.deductedCents !== 0) throw new Error("Amount and profit can only be edited before acceptance and before any wallet debit.");
        const amountCents = input.data.amount === undefined ? order.amountCents : cents(input.data.amount);
        const profitCents = input.data.profit === undefined ? order.profitCents : cents(input.data.profit);
        const history = [...order.history, { status: order.status, message: input.data.message || "Administrator revised required amount and expected profit before acceptance.", at: new Date().toISOString(), by: "admin" }];
        await tx.update(schema.sellerOrders).set({ amountCents, profitCents, history }).where(eq(schema.sellerOrders.id, order.id));
        await tx.update(schema.orders).set({ totalCents: amountCents }).where(eq(schema.orders.id, customerOrder.id));
        await tx.insert(schema.notifications).values({ userId: order.sellerId, title: `Order ORD-${order.id} terms updated`, message: `Required amount is now $${money(amountCents).toFixed(2)} and expected profit is $${money(profitCents).toFixed(2)}. Review before accepting.`, soId: order.id });
        await audit(admin.id, "sellerOrder", order.id, "financial_terms_updated", { amount: money(order.amountCents), profit: money(order.profitCents) }, { amount: money(amountCents), profit: money(profitCents) }, input.data.message || "Pre-acceptance financial terms updated.", tx);
        return;
      }
      const nextStatus = input.data.status || order.status;
      if (nextStatus === order.status && input.data.profitStatus === undefined) return;
      if (["Completed", "Cancelled", "Rejected"].includes(order.status) && input.data.profitStatus === undefined) throw new Error(`${order.status} orders are final and cannot be reopened or changed.`);
      if (input.data.profitStatus === "Paid" && (order.status !== "Completed" || !order.profitCredited)) throw new Error("Profit can only be marked paid after automatic wallet credit at completion.");
      if (order.status === "Awaiting Acceptance" && nextStatus !== "Cancelled") throw new Error("The Store owner must accept this order before the administrator can process, ship, or complete it.");
      if (order.deductedCents > 0 && order.deductedCents !== order.amountCents) throw new Error("The deducted amount does not match the order amount; settlement is blocked for review.");
      let returnedCents = order.returnedCents;
      let balanceAfterCompletionCents = order.balanceAfterCompletionCents;
      let profitCredited = order.profitCredited;
      let profitStatus = input.data.profitStatus ?? order.profitStatus;
      const now = new Date();
      if (nextStatus === "Completed" && order.status !== "Completed") {
        if (order.deductedCents !== order.amountCents || !order.acceptedAt) throw new Error("Completion requires a prior acceptance debit. Cancel this legacy order instead of bypassing wallet settlement.");
        const returned = await returnSellerPrincipal(tx, order);
        returnedCents = order.deductedCents;
        let walletAfter = returned.balance;
        if (!order.profitCredited) {
          const profit = await changeWallet(tx, order.sellerId, order.profitCents);
          walletAfter = profit.after;
          if (order.profitCents > 0) await tx.insert(schema.transactions).values({ userId: order.sellerId, type: "profit", amountCents: order.profitCents, note: `Profit credited — Order ORD-${order.id}`, orderId: customerOrder.id });
          profitCredited = true;
        }
        profitStatus = "Credited";
        balanceAfterCompletionCents = walletAfter;
      } else if (nextStatus === "Cancelled") {
        const returned = await returnSellerPrincipal(tx, order);
        returnedCents = order.returnedCents + returned.amount;
        if (returned.balance !== null) balanceAfterCompletionCents = returned.balance;
        await restoreOrderStock(tx, customerOrder);
        profitStatus = order.profitStatus;
      }
      const history = [...order.history, { status: nextStatus, message: input.data.message, at: now.toISOString(), by: "admin" }];
      await tx.update(schema.sellerOrders).set({ status: nextStatus, returnedCents, balanceAfterCompletionCents, profitCredited, profitStatus, completedAt: ["Completed", "Cancelled"].includes(nextStatus) ? now : order.completedAt, history }).where(eq(schema.sellerOrders.id, order.id));
      await tx.update(schema.orders).set({ status: nextStatus, completedAt: nextStatus === "Completed" ? now : customerOrder.completedAt }).where(eq(schema.orders.id, customerOrder.id));
      await tx.insert(schema.notifications).values({ userId: order.sellerId, title: `Order ORD-${order.id} ${nextStatus}`, message: input.data.message || (nextStatus === "Completed" ? `Completed by administrator. $${money(returnedCents).toFixed(2)} principal returned and $${money(order.profitCents).toFixed(2)} profit credited.` : `Administrator changed the order status to ${nextStatus}.`), soId: order.id });
      await audit(admin.id, "sellerOrder", order.id, "status_changed", { status: order.status, deducted: money(order.deductedCents), returned: money(order.returnedCents), profitStatus: order.profitStatus }, { status: nextStatus, returned: money(returnedCents), profitStatus, balanceAfterCompletion: balanceAfterCompletionCents === null ? null : money(balanceAfterCompletionCents) }, input.data.message || "Administrator updated seller order.", tx);
    });
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Seller-order update failed." }, 409);
  }
});

function excludedBranding(value: string) { return /amazon|\bstone\s*&\s*beam\b|\brivet\b|\bstrathwood\b|\b(?:umi|eono|proiron)\b|\bsimple joys by carter|\bcare of by puma\b/i.test(value); }
const productInput = z.object({
  id: z.number().int().positive().optional(), sku: z.string().trim().max(80).optional().default(""), name: z.string().trim().min(3).max(300), brand: z.string().trim().min(1).max(160),
  category: z.string().trim().min(2).max(120), subcategory: z.string().trim().min(2).max(160), description: z.string().trim().min(3).max(10000),
  price: z.number().min(40).max(1000), discountPercent: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(25), z.literal(30), z.literal(35), z.literal(40)]),
  stock: z.number().int().min(0).max(1_000_000), images: z.array(z.string().trim().refine((v) => /^https:\/\//i.test(v) || /^assets\//.test(v))).min(1).max(8), storeId: z.number().int().positive().nullable().optional(),
});

marketAdminRoutes.post("/products", async (c) => {
  const admin = await requireAdmin(c);
  const input = productInput.safeParse(await body(c));
  if (!input.success) return c.json({ error: "Complete all product fields with a $40–$1,000 price, valid discount, stock, and authentic image paths." }, 400);
  if (excludedBranding([input.data.name, input.data.brand, input.data.description].join(" "))) return c.json({ error: "Unauthorized marketplace or private-label branding is not allowed." }, 400);
  const db = getDb();
  const productId = input.data.id || (await db.query.products.findFirst({ orderBy: (fields, { desc }) => [desc(fields.id)] }))!.id + 1;
  const values = { id: productId, sku: input.data.sku || `MZ-${productId}`, name: input.data.name, brand: input.data.brand, category: input.data.category, subcategory: input.data.subcategory, description: input.data.description, priceCents: cents(input.data.price), mrpCents: cents(input.data.price / (1 - input.data.discountPercent / 100)), discountPercent: input.data.discountPercent, stock: input.data.stock, image: input.data.images[0], images: input.data.images, storeId: input.data.storeId || null, data: { ...input.data, id: productId, sku: input.data.sku || `MZ-${productId}`, mrp: Math.round(input.data.price / (1 - input.data.discountPercent / 100) * 100) / 100, image: input.data.images[0], source: "admin", custom: true, commissionRate: 0, rating: null, reviews: null } };
  try {
    await db.insert(schema.products).values(values);
    await audit(admin.id, "product", productId, "created", null, { name: input.data.name, price: input.data.price, stock: input.data.stock }, "Administrator added a catalog product.");
    return c.json({ ok: true, id: productId }, 201);
  } catch { return c.json({ error: "Product ID or SKU already exists." }, 409); }
});

marketAdminRoutes.patch("/products/:id", async (c) => {
  const admin = await requireAdmin(c);
  const productId = id.safeParse(c.req.param("id"));
  const input = productInput.safeParse(await body(c));
  if (!productId.success || !input.success) return c.json({ error: "Invalid product values." }, 400);
  if (excludedBranding([input.data.name, input.data.brand, input.data.description].join(" "))) return c.json({ error: "Unauthorized marketplace or private-label branding is not allowed." }, 400);
  const db = getDb();
  const old = await db.query.products.findFirst({ where: eq(schema.products.id, productId.data) });
  if (!old) return c.json({ error: "Product not found." }, 404);
  const data = { ...old.data, ...input.data, id: old.id, sku: input.data.sku || old.sku, mrp: Math.round(input.data.price / (1 - input.data.discountPercent / 100) * 100) / 100, image: input.data.images[0] };
  await db.update(schema.products).set({ sku: data.sku, name: input.data.name, brand: input.data.brand, category: input.data.category, subcategory: input.data.subcategory, description: input.data.description, priceCents: cents(input.data.price), mrpCents: cents(data.mrp), discountPercent: input.data.discountPercent, stock: input.data.stock, image: input.data.images[0], images: input.data.images, storeId: input.data.storeId || null, data }).where(eq(schema.products.id, old.id));
  await audit(admin.id, "product", old.id, "updated", { price: money(old.priceCents), stock: old.stock }, { price: input.data.price, stock: input.data.stock }, "Administrator updated catalog product.");
  return c.json({ ok: true });
});

marketAdminRoutes.delete("/products/:id", async (c) => {
  const admin = await requireAdmin(c);
  const productId = id.safeParse(c.req.param("id"));
  if (!productId.success) return c.json({ error: "Invalid product." }, 400);
  const db = getDb();
  const old = await db.query.products.findFirst({ where: eq(schema.products.id, productId.data) });
  if (!old) return c.json({ error: "Product not found." }, 404);
  await db.delete(schema.products).where(eq(schema.products.id, old.id));
  await audit(admin.id, "product", old.id, "deleted", { name: old.name, sku: old.sku }, null, "Product removed; historical order snapshots remain unchanged.");
  return c.json({ ok: true });
});

marketAdminRoutes.post("/referrals", async (c) => {
  const admin = await requireAdmin(c);
  const input = z.object({ count: z.number().int().min(1).max(50) }).safeParse(await body(c));
  if (!input.success) return c.json({ error: "Generate between 1 and 50 codes." }, 400);
  const codes = Array.from({ length: input.data.count }, () => ({ code: referralCode(), createdBy: admin.id }));
  await getDb().insert(schema.referralCodes).values(codes);
  return c.json({ ok: true, codes: codes.map((x) => x.code) }, 201);
});

marketAdminRoutes.patch("/withdrawals/:id", async (c) => {
  const admin = await requireAdmin(c);
  const withdrawalId = id.safeParse(c.req.param("id"));
  const input = z.object({ status: z.enum(["Completed", "Rejected"]), note: z.string().trim().max(500).optional().default("") }).safeParse(await body(c));
  if (!withdrawalId.success || !input.success) return c.json({ error: "Invalid withdrawal review." }, 400);
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, withdrawalId.data)).for("update");
      const withdrawal = rows[0];
      if (!withdrawal || withdrawal.status !== "Pending") throw new Error("This withdrawal has already been processed.");
      await tx.update(schema.withdrawals).set({ status: input.data.status, processedAt: new Date() }).where(eq(schema.withdrawals.id, withdrawal.id));
      if (input.data.status === "Rejected") {
        await changeWallet(tx, withdrawal.userId, withdrawal.amountCents);
        await tx.insert(schema.transactions).values({ userId: withdrawal.userId, type: "refund", amountCents: withdrawal.amountCents, note: `Rejected withdrawal #${withdrawal.id} refund` });
      }
      await tx.insert(schema.notifications).values({ userId: withdrawal.userId, title: `Withdrawal #${withdrawal.id} ${input.data.status.toLowerCase()}`, message: input.data.note || `Your withdrawal request was marked ${input.data.status}.` });
      await audit(admin.id, "withdrawal", withdrawal.id, "reviewed", { status: withdrawal.status }, { status: input.data.status }, input.data.note || "Administrator reviewed withdrawal.", tx);
    });
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Withdrawal review failed." }, 409);
  }
});

marketAdminRoutes.patch("/assistance/:id", async (c) => {
  const admin = await requireAdmin(c);
  const requestId = id.safeParse(c.req.param("id"));
  const input = z.object({ status: z.enum(["Reviewed", "Resolved"]), note: z.string().trim().max(1000).optional().default("") }).safeParse(await body(c));
  if (!requestId.success || !input.success) return c.json({ error: "Invalid assistance review." }, 400);
  const db = getDb();
  const request = await db.query.assistanceRequests.findFirst({ where: eq(schema.assistanceRequests.id, requestId.data) });
  if (!request) return c.json({ error: "Assistance request not found." }, 404);
  await db.update(schema.assistanceRequests).set({ status: input.data.status }).where(eq(schema.assistanceRequests.id, request.id));
  await notify(request.userId, `Manual assistance request #${request.id} ${input.data.status.toLowerCase()}`, input.data.note || "An administrator reviewed your manual order assistance request.");
  await audit(admin.id, "assistance", request.id, "reviewed", { status: request.status }, { status: input.data.status }, input.data.note || "Administrator reviewed manual assistance request.");
  return c.json({ ok: true });
});
