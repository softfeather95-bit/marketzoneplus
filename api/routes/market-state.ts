import { Hono } from "hono";
import { desc, eq, or } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { ensureCatalogSeed } from "../market/seed";
import { requireUser, publicUser, mapStore, mapProduct, mapOrder, mapSellerOrder, money, iso } from "../market/utils";

export const marketStateRoutes = new Hono();

marketStateRoutes.get("/state", async (c) => {
  const user = await requireUser(c);
  await ensureCatalogSeed();
  const db = getDb();
  const admin = user.role === "admin";
  const light = c.req.query("light") === "1";
  const [allUsers, allStores, productRows, orderRows, sellerRows, walletRows, txRows, depositRows, notificationRows, withdrawalRows, credentialRows, referralRows, assistanceRows, auditRows] = await Promise.all([
    admin ? db.select().from(schema.users) : db.select().from(schema.users).where(or(eq(schema.users.id, user.id), eq(schema.users.referredBy, user.id))),
    admin ? db.select().from(schema.stores) : db.select().from(schema.stores).where(or(eq(schema.stores.status, "approved"), eq(schema.stores.userId, user.id))),
    light ? db.select({ id: schema.products.id, stock: schema.products.stock, storeId: schema.products.storeId }).from(schema.products) : db.select().from(schema.products),
    admin ? db.select().from(schema.orders) : db.select().from(schema.orders).where(eq(schema.orders.userId, user.id)),
    admin ? db.select().from(schema.sellerOrders) : db.select().from(schema.sellerOrders).where(eq(schema.sellerOrders.sellerId, user.id)),
    admin ? db.select().from(schema.wallets) : db.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id)),
    admin ? db.select().from(schema.transactions) : db.select().from(schema.transactions).where(eq(schema.transactions.userId, user.id)),
    admin ? db.select().from(schema.deposits) : db.select().from(schema.deposits).where(eq(schema.deposits.userId, user.id)),
    db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)),
    admin ? db.select().from(schema.withdrawals) : db.select().from(schema.withdrawals).where(eq(schema.withdrawals.userId, user.id)),
    db.select({ userId: schema.credentials.userId }).from(schema.credentials),
    admin ? db.select().from(schema.referralCodes) : Promise.resolve([]),
    admin ? db.select().from(schema.assistanceRequests).orderBy(desc(schema.assistanceRequests.id)) : Promise.resolve([]),
    admin ? db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.id)).limit(200) : Promise.resolve([]),
  ]);
  const credentialUsers = new Set(credentialRows.map((row) => row.userId));
  const storeOwnerIds = [...new Set(allStores.map((s) => s.userId))];
  const owners = storeOwnerIds.length ? await db.select().from(schema.users).where(or(...storeOwnerIds.map((id) => eq(schema.users.id, id)))) : [];
  const ownerMap = new Map(owners.map((u) => [u.id, u]));
  const sellerMap = new Map(sellerRows.map((s) => [s.customerOrderId, s.id]));
  const storeNameMap = new Map(allStores.map((s) => [s.id, s.storeName]));
  const wallets: Record<string, number> = {};
  walletRows.forEach((w) => { wallets[w.userId] = money(w.balanceCents); });
  if (wallets[user.id] === undefined) wallets[user.id] = 0;

  return c.json({
    user: publicUser(user, credentialUsers.has(user.id)),
    users: allUsers.map((u) => publicUser(u, credentialUsers.has(u.id))),
    stores: allStores.map((s) => {
      const mapped = mapStore(s, ownerMap.get(s.userId));
      if (!admin && s.userId !== user.id) return { ...mapped, userEmail: "", docImage: "", refCode: "" };
      if (light) return { ...mapped, docImage: "" };
      return mapped;
    }),
    products: light ? productRows.map((p) => ({ id: p.id, stock: p.stock, storeId: p.storeId || 0 })) : (productRows as Array<typeof schema.products.$inferSelect>).map(mapProduct),
    orders: orderRows.map((o) => mapOrder(o, sellerMap.get(o.id) || 0)),
    sellerOrders: sellerRows.map((s) => mapSellerOrder(s, storeNameMap.get(s.storeId) || "")),
    wallets,
    txs: txRows.map((t) => ({ ...t, amount: money(t.amountCents), createdAt: iso(t.createdAt) })),
    deposits: depositRows.map((d) => ({ ...d, amount: money(d.amountCents), createdAt: iso(d.createdAt), processedAt: iso(d.processedAt) })),
    notifs: notificationRows.map((n) => ({ ...n, createdAt: iso(n.createdAt) })),
    withdrawals: withdrawalRows.map((w) => ({ ...w, amount: money(w.amountCents), address: w.destination, createdAt: iso(w.createdAt), processedAt: iso(w.processedAt) })),
    refCodes: referralRows.map((r) => ({ ...r, createdAt: iso(r.createdAt), usedAt: iso(r.usedAt) })),
    assistance: assistanceRows.map((a) => ({ ...a, createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt) })),
    audits: auditRows.map((a) => ({ ...a, createdAt: iso(a.createdAt) })),
    serverTime: new Date().toISOString(),
  });
});
