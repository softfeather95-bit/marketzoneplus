import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { COUNTRY_BY_NAME } from "@contracts/countries";
import { requireUser, hashPassword, verifyPassword, cents, money, notifyAdmins, FROZEN_ACCOUNT_MESSAGE } from "../market/utils";
import { ensureCatalogSeed } from "../market/seed";
import { assertAccountNotFrozen, changeWallet, restoreOrderStock } from "../market/order-utils";

export const marketCustomerRoutes = new Hono();
const objectBody = async (c: Context) => c.req.json().catch(() => null);
const idSchema = z.coerce.number().int().positive();
const UNAVAILABLE = "This product is currently unavailable in your country. Please contact the administrator for manual order assistance.";

marketCustomerRoutes.patch("/profile", async (c) => {
  const user = await requireUser(c);
  const input = z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().toLowerCase().email().max(320) }).safeParse(await objectBody(c));
  if (!input.success) return c.json({ error: "Enter a valid name and email address." }, 400);
  const db = getDb();
  const duplicate = await db.select({ id: schema.credentials.id }).from(schema.credentials).where(eq(schema.credentials.email, input.data.email)).limit(1);
  if (duplicate.length && duplicate[0].id !== user.id) {
    const owner = await db.select({ userId: schema.credentials.userId }).from(schema.credentials).where(eq(schema.credentials.id, duplicate[0].id)).limit(1);
    if (owner[0]?.userId !== user.id) return c.json({ error: "That email is already registered." }, 409);
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ name: input.data.name, email: input.data.email }).where(eq(schema.users.id, user.id));
    await tx.update(schema.credentials).set({ email: input.data.email }).where(eq(schema.credentials.userId, user.id));
  });
  return c.json({ ok: true });
});

marketCustomerRoutes.post("/password", async (c) => {
  const user = await requireUser(c);
  const input = z.object({ current: z.string().min(1), password: z.string().min(8).max(200), confirm: z.string().min(8).max(200) }).safeParse(await objectBody(c));
  if (!input.success || input.data.password !== input.data.confirm) return c.json({ error: "New passwords must match and contain at least 8 characters." }, 400);
  const db = getDb();
  const row = await db.select().from(schema.credentials).where(eq(schema.credentials.userId, user.id)).limit(1);
  if (!row[0] || !verifyPassword(input.data.current, row[0].passwordHash)) return c.json({ error: "Current password is incorrect." }, 400);
  await db.update(schema.credentials).set({ passwordHash: hashPassword(input.data.password) }).where(eq(schema.credentials.userId, user.id));
  return c.json({ ok: true });
});

marketCustomerRoutes.post("/stores", async (c) => {
  const user = await requireUser(c);
  if (user.withdrawHold) return c.json({ error: FROZEN_ACCOUNT_MESSAGE, frozen: true }, 403);
  if (user.role !== "user") return c.json({ error: "Customer access is required." }, 403);
  const input = z.object({
    storename: z.string().trim().min(3).max(180), storecat: z.string().trim().min(2).max(120),
    description: z.string().trim().min(20).max(5000), gender: z.enum(["Male", "Female"]),
    country: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(1).max(35), doctype: z.string().trim().min(2).max(80),
    docdata: z.string().max(3_600_000).optional().default(""), refcode: z.string().trim().regex(/^\d{9}$/).optional().or(z.literal("")),
  }).safeParse(await objectBody(c));
  if (!input.success) return c.json({ error: "Complete all required Store fields, including gender, country, valid phone, description, and verification document." }, 400);
  const country = COUNTRY_BY_NAME.get(input.data.country);
  if (!country) return c.json({ error: "Select a valid country." }, 400);
  if (input.data.docdata && !/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/i.test(input.data.docdata)) return c.json({ error: "The verification document must be a PNG, JPEG, WebP, or PDF." }, 400);
  const db = getDb();
  const existing = await db.select().from(schema.stores).where(eq(schema.stores.userId, user.id)).limit(1);
  if (existing[0] && existing[0].status !== "rejected") return c.json({ error: "A Store application already exists for this account." }, 409);
  if (!existing[0] && !input.data.docdata) return c.json({ error: "Upload the required verification document." }, 400);
  if (input.data.refcode) {
    const invitation = await db.select().from(schema.referralCodes).where(eq(schema.referralCodes.code, input.data.refcode)).limit(1);
    if (!invitation[0] || invitation[0].usedBy) return c.json({ error: "This Store invitation code is invalid or already used." }, 400);
  }
  const storeCount = await db.select({ id: schema.stores.id }).from(schema.stores).limit(1);
  const initialOffice = !existing[0] && storeCount.length === 0 ? {
    ownerName: "Anderson", houseNumber: "76", street: "Demo Road", apartment: "5C",
    city: "Manhattan", state: "NY", zip: "10001", officeCountry: "United States",
  } : {};
  const values = {
    userId: user.id, storeName: input.data.storename, category: input.data.storecat,
    description: input.data.description, gender: input.data.gender, country: country.name,
    dialingCode: country.dial, phone: input.data.phone,
    docType: input.data.doctype, docImage: input.data.docdata || existing[0]?.docImage || null,
    refCode: input.data.refcode || null, status: "pending" as const, rejectReason: null,
    creditScore: existing[0]?.creditScore ?? 100, rating: existing[0]?.rating ?? "5.0",
    visitors: existing[0]?.visitors ?? 0, views: existing[0]?.views ?? 0,
    productIds: existing[0]?.productIds ?? [], reviewedAt: null, ...initialOffice,
  };
  const storeId = await db.transaction(async (tx) => {
    let id: number;
    if (existing[0]) {
      id = existing[0].id;
      await tx.update(schema.stores).set(values).where(eq(schema.stores.id, id));
    } else {
      [{ id }] = await tx.insert(schema.stores).values(values).$returningId();
    }
    if (input.data.refcode) await tx.update(schema.referralCodes).set({ usedBy: user.id, usedAt: new Date() }).where(eq(schema.referralCodes.code, input.data.refcode));
    await tx.insert(schema.notifications).values({ userId: user.id, title: "Store application submitted", message: `${input.data.storename} was submitted for administrator review. Credit score 100 and rating 5.0 are initialized by the server.` });
    return id;
  });
  await notifyAdmins("New Store application", `${user.name || user.email} submitted ${input.data.storename} for review.`);
  return c.json({ ok: true, id: storeId }, existing[0] ? 200 : 201);
});

marketCustomerRoutes.post("/stores/products", async (c) => {
  const user = await requireUser(c);
  if (user.withdrawHold) return c.json({ error: FROZEN_ACCOUNT_MESSAGE, frozen: true }, 403);
  const input = z.object({ productId: idSchema, storeId: idSchema, remove: z.boolean().optional().default(false) }).safeParse(await objectBody(c));
  if (!input.success) return c.json({ error: "Invalid Store product selection." }, 400);
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
    const storeRows = await tx.select().from(schema.stores).where(and(eq(schema.stores.id, input.data.storeId), eq(schema.stores.userId, user.id))).for("update");
    const store = storeRows[0];
    if (!store || store.status !== "approved") throw new Error("An approved Store owned by your account is required.");
    const productRows = await tx.select().from(schema.products).where(eq(schema.products.id, input.data.productId)).for("update");
    const product = productRows[0];
    if (!product) throw new Error("Product not found.");
    if (!input.data.remove && product.storeId && product.storeId !== store.id) throw new Error("This product is already assigned to another Store.");
    const ids = new Set((store.productIds || []).map(Number));
    if (input.data.remove) ids.delete(product.id); else ids.add(product.id);
    await tx.update(schema.products).set({ storeId: input.data.remove && product.storeId === store.id ? null : input.data.remove ? product.storeId : store.id }).where(eq(schema.products.id, product.id));
    await tx.update(schema.stores).set({ productIds: [...ids] }).where(eq(schema.stores.id, store.id));
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Store product selection failed." }, 409);
  }
  return c.json({ ok: true });
});

marketCustomerRoutes.post("/checkout", async (c) => {
  const user = await requireUser(c);
  if (user.withdrawHold) return c.json({ error: FROZEN_ACCOUNT_MESSAGE, frozen: true }, 403);
  if (user.role !== "user") return c.json({ error: "Customer access is required." }, 403);
  await ensureCatalogSeed();
  const input = z.object({
    items: z.array(z.object({ productId: idSchema, qty: z.number().int().min(1).max(100) })).min(1).max(100),
    address: z.string().trim().min(5).max(1000), city: z.string().trim().min(2).max(160),
    phone: z.string().trim().min(7).max(50), country: z.string().trim().min(2).max(100),
    paymentMethod: z.enum(["Wallet Balance", "COD"]), idempotencyKey: z.string().trim().min(12).max(100),
  }).safeParse(await objectBody(c));
  if (!input.success) return c.json({ error: "Complete the shipping address, country, phone, payment method, and valid cart quantities." }, 400);
  if (input.data.country !== "United States") return c.json({ error: UNAVAILABLE, unavailable: true }, 422);
  const db = getDb();
  const key = `${user.id}:${input.data.idempotencyKey}`;
  const previous = await db.query.orders.findFirst({ where: eq(schema.orders.idempotencyKey, key) });
  if (previous) return c.json({ ok: true, duplicate: true, orderId: previous.id });
  const merged = new Map<number, number>();
  input.data.items.forEach((item) => merged.set(item.productId, (merged.get(item.productId) || 0) + item.qty));
  try {
    const result = await db.transaction(async (tx) => {
      const productRows = await tx.select().from(schema.products).where(inArray(schema.products.id, [...merged.keys()])).for("update");
      if (productRows.length !== merged.size) throw new Error("A product in your cart is no longer available.");
      const storeRows = await tx.select().from(schema.stores);
      const storeMap = new Map(storeRows.map((s) => [s.id, s]));
      let subtotal = 0;
      const items = productRows.map((p) => {
        const qty = merged.get(p.id)!;
        if (p.stock < qty) throw new Error(`${p.name} has insufficient stock.`);
        subtotal += p.priceCents * qty;
        const store = p.storeId ? storeMap.get(p.storeId) : undefined;
        return {
          productId: p.id, name: p.name, qty, price: money(p.priceCents), mrp: money(p.mrpCents),
          discountPercent: p.discountPercent, commission: 0, storeId: store?.status === "approved" ? store.id : 0,
          storeName: store?.status === "approved" ? store.storeName : "", image: p.image,
        };
      });
      const shipping = subtotal >= 5000 ? 0 : 599;
      const total = subtotal + shipping;
      const wallet = await tx.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id)).for("update");
      const balance = wallet[0]?.balanceCents || 0;
      await assertAccountNotFrozen(tx, user.id);
      if (input.data.paymentMethod === "Wallet Balance" && balance < total) throw new Error("Insufficient wallet balance. Submit a deposit request or contact the administrator.");
      const [{ id }] = await tx.insert(schema.orders).values({
        userId: user.id, manual: false, status: "Pending", totalCents: total, shippingCents: shipping,
        paymentMethod: input.data.paymentMethod, address: `${input.data.address}, ${input.data.city}`,
        phone: input.data.phone, country: input.data.country, items, idempotencyKey: key,
      }).$returningId();
      if (input.data.paymentMethod === "Wallet Balance") {
        if (wallet[0]) await tx.update(schema.wallets).set({ balanceCents: balance - total }).where(eq(schema.wallets.userId, user.id));
        else await tx.insert(schema.wallets).values({ userId: user.id, balanceCents: -total });
        await tx.insert(schema.transactions).values({ userId: user.id, type: "purchase", amountCents: -total, note: `Order #${id} payment (Wallet Balance)`, orderId: id });
      }
      for (const p of productRows) await tx.update(schema.products).set({ stock: p.stock - merged.get(p.id)! }).where(eq(schema.products.id, p.id));
      await tx.insert(schema.notifications).values({ userId: user.id, title: `Order #${id} placed`, message: `${input.data.paymentMethod} order confirmed with total $${money(total).toFixed(2)}.` });
      return { id, total };
    });
    await notifyAdmins("New customer order", `Order #${result.id} was placed by ${user.name || user.email}.`);
    return c.json({ ok: true, orderId: result.id, total: money(result.total) }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Checkout could not be completed." }, 409);
  }
});

marketCustomerRoutes.post("/orders/:id/cancel", async (c) => {
  const user = await requireUser(c);
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "Invalid order." }, 400);
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(schema.orders).where(and(eq(schema.orders.id, id.data), eq(schema.orders.userId, user.id))).for("update");
      const order = rows[0];
      if (!order || order.status !== "Pending" || order.manual) throw new Error("Only your pending customer order can be cancelled.");
      await tx.update(schema.orders).set({ status: "Cancelled" }).where(eq(schema.orders.id, order.id));
      await restoreOrderStock(tx, order);
      if (order.paymentMethod === "Wallet Balance" && !order.refundIssued) {
        await changeWallet(tx, user.id, order.totalCents);
        await tx.insert(schema.transactions).values({ userId: user.id, type: "refund", amountCents: order.totalCents, note: `Refund for cancelled order #${order.id}`, orderId: order.id });
        await tx.update(schema.orders).set({ refundIssued: true }).where(eq(schema.orders.id, order.id));
      }
      await tx.insert(schema.notifications).values({ userId: user.id, title: `Order #${order.id} cancelled`, message: "Your pending order was cancelled and its stock was restored. Any wallet payment has been refunded." });
    });
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Cancellation failed." }, 409);
  }
});

marketCustomerRoutes.post("/deposits", async (c) => {
  const user = await requireUser(c);
  if (user.withdrawHold) return c.json({ error: FROZEN_ACCOUNT_MESSAGE, frozen: true }, 403);
  if (user.role !== "user") return c.json({ error: "Customer access is required." }, 403);
  const input = z.object({ amount: z.number().min(1).max(1_000_000), reference: z.string().trim().max(120).optional().default(""), storeId: idSchema.optional() }).safeParse(await objectBody(c));
  if (!input.success) return c.json({ error: "Enter a deposit amount from $1 to $1,000,000." }, 400);
  const db = getDb();
  let reference = input.data.reference;
  if (input.data.storeId !== undefined) {
    const store = await db.query.stores.findFirst({ where: and(eq(schema.stores.id, input.data.storeId), eq(schema.stores.userId, user.id)) });
    if (!store || store.status !== "approved") return c.json({ error: "An approved Store owned by your account is required to request a Store deposit." }, 403);
    reference = `Store MZ-${store.id} (${store.storeName})`.slice(0, 160);
  }
  const [{ id }] = await db.insert(schema.deposits).values({ userId: user.id, amountCents: cents(input.data.amount), reference }).$returningId();
  await notifyAdmins("New deposit request", `${user.name || user.email} requested a $${input.data.amount.toFixed(2)} deposit${input.data.storeId !== undefined ? ` for approved Store MZ-${input.data.storeId}` : ""} in request #${id}. Balance remains unchanged until administrator approval.`);
  return c.json({ ok: true, id, balanceChanged: false }, 201);
});

marketCustomerRoutes.post("/assistance", async (c) => {
  const user = await requireUser(c);
  if (user.withdrawHold) return c.json({ error: FROZEN_ACCOUNT_MESSAGE, frozen: true }, 403);
  const input = z.object({ productId: idSchema.optional(), country: z.string().trim().min(2).max(100), message: z.string().trim().min(5).max(2000) }).safeParse(await objectBody(c));
  if (!input.success) return c.json({ error: "Provide your country and a short manual-assistance message." }, 400);
  const [{ id }] = await getDb().insert(schema.assistanceRequests).values({ userId: user.id, productId: input.data.productId, country: input.data.country, message: input.data.message }).$returningId();
  await notifyAdmins("Manual order assistance requested", `${user.name || user.email} requested assistance for ${input.data.country}. Request #${id}.`);
  return c.json({ ok: true, id }, 201);
});

marketCustomerRoutes.post("/notifications/read", async (c) => {
  const user = await requireUser(c);
  await getDb().update(schema.notifications).set({ read: true }).where(eq(schema.notifications.userId, user.id));
  return c.json({ ok: true });
});

marketCustomerRoutes.post("/withdrawals", async (c) => {
  const user = await requireUser(c);
  if (user.withdrawHold) return c.json({ error: FROZEN_ACCOUNT_MESSAGE, frozen: true }, 403);
  const input = z.object({ amount: z.number().min(1).max(1_000_000), method: z.string().trim().min(2).max(40), destination: z.string().trim().min(8).max(500), store: z.string().trim().max(180).optional().default(""), storeId: idSchema.optional() }).safeParse(await objectBody(c));
  if (!input.success) return c.json({ error: "Enter a valid amount and withdrawal destination." }, 400);
  const db = getDb();
  let storeName = input.data.store;
  if (input.data.storeId !== undefined) {
    const store = await db.query.stores.findFirst({ where: and(eq(schema.stores.id, input.data.storeId), eq(schema.stores.userId, user.id)) });
    if (!store || store.status !== "approved") return c.json({ error: "An approved Store owned by your account is required to request a Store withdrawal." }, 403);
    storeName = store.storeName;
  }
  try {
    const id = await db.transaction(async (tx) => {
      const amount = cents(input.data.amount);
      const wallet = await tx.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id)).for("update");
      await assertAccountNotFrozen(tx, user.id);
      if (!wallet[0] || wallet[0].balanceCents < amount) throw new Error("Insufficient available wallet balance.");
      const [{ id }] = await tx.insert(schema.withdrawals).values({ userId: user.id, amountCents: amount, method: input.data.method, destination: input.data.destination, storeName }).$returningId();
      await tx.update(schema.wallets).set({ balanceCents: wallet[0].balanceCents - amount }).where(eq(schema.wallets.userId, user.id));
      await tx.insert(schema.transactions).values({ userId: user.id, type: "debit", amountCents: -amount, note: `Withdrawal request #${id}` });
      return id;
    });
    await notifyAdmins("New withdrawal request", `${user.name || user.email} requested withdrawal #${id}${input.data.storeId !== undefined ? ` for Store MZ-${input.data.storeId}` : ""}.`);
    return c.json({ ok: true, id }, 201);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Withdrawal failed." }, 409); }
});

marketCustomerRoutes.patch("/seller-orders/:id", async (c) => {
  const user = await requireUser(c);
  if (user.withdrawHold) return c.json({ error: FROZEN_ACCOUNT_MESSAGE, frozen: true }, 403);
  const id = idSchema.safeParse(c.req.param("id"));
  const input = z.object({ status: z.enum(["Accepted", "Rejected"]), message: z.string().trim().max(1000).optional().default("") }).safeParse(await objectBody(c));
  if (!id.success || !input.success) return c.json({ error: "Store owners may only accept or reject an order awaiting acceptance." }, 400);
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const sellerRows = await tx.select().from(schema.sellerOrders).where(and(eq(schema.sellerOrders.id, id.data), eq(schema.sellerOrders.sellerId, user.id))).for("update");
      const order = sellerRows[0];
      if (!order) throw new Error("Seller order not found.");
      if (order.status !== "Awaiting Acceptance") throw new Error(`Order ORD-${order.id} is ${order.status}; only the administrator can manage it after acceptance.`);
      const customerRows = await tx.select().from(schema.orders).where(eq(schema.orders.id, order.customerOrderId)).for("update");
      const customerOrder = customerRows[0];
      if (!customerOrder || customerOrder.status === "Cancelled") throw new Error("The linked customer order is cancelled and cannot be reopened.");
      const storeRows = await tx.select().from(schema.stores).where(and(eq(schema.stores.id, order.storeId), eq(schema.stores.userId, user.id))).for("update");
      if (!storeRows[0] || storeRows[0].status !== "approved") throw new Error("An approved Store owned by your account is required.");
      await assertAccountNotFrozen(tx, user.id);
      const now = new Date();
      const history = [...order.history, { status: input.data.status, message: input.data.message, at: now.toISOString(), by: "seller" }];
      let balanceAfter: number | null = null;
      if (input.data.status === "Accepted") {
        if (order.deductedCents !== 0 || order.returnedCents !== 0) throw new Error("This order has an inconsistent financial state. Contact the administrator.");
        const walletRows = await tx.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id)).for("update");
        const available = walletRows[0]?.balanceCents || 0;
        if (available < order.amountCents) {
          throw new Error(`Insufficient wallet funds. Required $${money(order.amountCents).toFixed(2)}; available $${money(available).toFixed(2)}.`);
        }
        const wallet = await changeWallet(tx, user.id, -order.amountCents);
        balanceAfter = wallet.after;
        await tx.insert(schema.transactions).values({ userId: user.id, type: "order_debit", amountCents: -order.amountCents, note: `Order acceptance debit — ORD-${order.id}`, orderId: customerOrder.id });
        await tx.update(schema.sellerOrders).set({ status: "Accepted", history, deductedCents: order.amountCents, balanceAfterDebitCents: wallet.after, acceptedAt: now }).where(eq(schema.sellerOrders.id, order.id));
        await tx.update(schema.orders).set({ status: "Processing" }).where(eq(schema.orders.id, customerOrder.id));
        await notifyAdmins("Store order accepted", `${storeRows[0].storeName} accepted ORD-${order.id}. $${money(order.amountCents).toFixed(2)} was deducted; processing is awaiting administrator management.`, tx);
      } else {
        await tx.update(schema.sellerOrders).set({ status: "Rejected", history, completedAt: now }).where(eq(schema.sellerOrders.id, order.id));
        await tx.update(schema.orders).set({ status: "Cancelled" }).where(eq(schema.orders.id, customerOrder.id));
        await restoreOrderStock(tx, customerOrder);
        await notifyAdmins("Store order rejected", `${storeRows[0].storeName} rejected ORD-${order.id}. Reserved stock was restored and no wallet debit occurred.`, tx);
      }
      await tx.insert(schema.notifications).values({ userId: customerOrder.userId, title: `Order ORD-${order.id} ${input.data.status}`, message: input.data.message || (input.data.status === "Accepted" ? `$${money(order.amountCents).toFixed(2)} was deducted once. The administrator now manages processing and delivery.` : "The order was rejected before acceptance; no funds were deducted."), soId: order.id });
      return { balanceAfter };
    });
    return c.json({ ok: true, balance: result.balanceAfter === null ? null : money(result.balanceAfter) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seller-order update failed.";
    return c.json({ error: message }, message === "Seller order not found." ? 404 : 409);
  }
});
