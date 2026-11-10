import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { authenticateRequest } from "../kimi/auth";
import { signSessionToken } from "../kimi/session";
import { getSessionCookieOptions } from "../lib/cookies";
import { Session } from "@contracts/constants";
import { env } from "../lib/env";
import * as schema from "@db/schema";

export type Actor = typeof schema.users.$inferSelect;
type MarketDatabase = ReturnType<typeof getDb>;
type MarketTransaction = Parameters<Parameters<MarketDatabase["transaction"]>[0]>[0];
type MarketWriter = MarketDatabase | MarketTransaction;
export const money = (cents: number) => Math.round(cents) / 100;
export const cents = (value: number) => Math.round(value * 100);
export const FROZEN_ACCOUNT_MESSAGE = "Your account is frozen by the administrator. Please contact the administrator to restore access.";
export const iso = (value: Date | null | undefined) => value ? value.toISOString() : "";

export async function actor(c: Context): Promise<Actor | null> {
  try {
    const user = await authenticateRequest(c.req.raw.headers);
    return user.status === "active" ? user : null;
  } catch {
    return null;
  }
}

export async function requireUser(c: Context) {
  const user = await actor(c);
  if (!user) throw new AuthError("Authentication required", 401);
  return user;
}

export async function requireAdmin(c: Context) {
  const user = await requireUser(c);
  if (user.role !== "admin") throw new AuthError("Administrator access required", 403);
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) { super(message); this.status = status; }
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function publicUser(user: Actor, hasCredential = false) {
  return {
    id: user.id,
    name: user.name || "MarketZone Customer",
    email: user.email || "",
    role: user.role === "admin" ? "admin" : "customer",
    status: user.status,
    avatar: user.avatar || "",
    referralCode: user.referralCode || "",
    referredBy: user.referredBy || 0,
    referredAt: iso(user.referredAt),
    withdrawHold: user.withdrawHold,
    hasPassword: hasCredential,
    createdAt: iso(user.createdAt),
  };
}

export async function startSession(c: Context, user: Actor) {
  const token = await signSessionToken({ unionId: user.unionId, clientId: env.appId });
  setCookie(c, Session.cookieName, token, {
    ...getSessionCookieOptions(c.req.raw.headers),
    maxAge: Session.maxAgeMs / 1000,
  });
}

export function endSession(c: Context) {
  deleteCookie(c, Session.cookieName, { path: "/" });
}

export async function notify(userId: number, title: string, message: string, soId = 0, db: MarketWriter = getDb()) {
  await db.insert(schema.notifications).values({ userId, title, message, soId: soId || null });
}

export async function notifyAdmins(title: string, message: string, db: MarketWriter = getDb()) {
  const admins = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, "admin"));
  if (admins.length) await db.insert(schema.notifications).values(admins.map((a: { id: number }) => ({ userId: a.id, title, message })));
}

export async function audit(adminId: number, entityType: string, entityId: number | string, action: string, previousValue: unknown, newValue: unknown, details: string, db: MarketWriter = getDb()) {
  await db.insert(schema.auditLogs).values({
    adminId, entityType, entityId: String(entityId), action,
    previousValue: previousValue === undefined ? null : JSON.parse(JSON.stringify(previousValue)),
    newValue: newValue === undefined ? null : JSON.parse(JSON.stringify(newValue)),
    details,
  });
}

export function mapStore(row: typeof schema.stores.$inferSelect, user?: Actor) {
  return {
    ...row,
    rating: Number(row.rating),
    productIds: Array.isArray(row.productIds) ? row.productIds : [],
    userName: user?.name || "",
    userEmail: user?.email || "",
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), reviewedAt: iso(row.reviewedAt),
  };
}

export function mapProduct(row: typeof schema.products.$inferSelect) {
  return {
    ...row.data,
    id: row.id, sku: row.sku, name: row.name, brand: row.brand,
    category: row.category, subcategory: row.subcategory, description: row.description,
    price: money(row.priceCents), mrp: money(row.mrpCents), discountPercent: row.discountPercent,
    stock: row.stock, image: row.image, images: row.images, storeId: row.storeId || 0,
  };
}

export function mapOrder(row: typeof schema.orders.$inferSelect, sellerOrderId = 0) {
  return {
    id: row.id, userId: row.userId, manual: row.manual, status: row.status,
    total: money(row.totalCents), shipping: money(row.shippingCents),
    pay: row.paymentMethod, paymentMethod: row.paymentMethod,
    address: row.address, phone: row.phone, country: row.country,
    items: row.items, sellerOrderId, restored: row.stockRestored, refunded: row.refundIssued,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), completedAt: iso(row.completedAt),
  };
}

export function mapSellerOrder(row: typeof schema.sellerOrders.$inferSelect, storeName = "") {
  return {
    ...row, storeName, amount: money(row.amountCents), profit: money(row.profitCents),
    deducted: money(row.deductedCents), returned: money(row.returnedCents),
    balanceAfterDebit: row.balanceAfterDebitCents === null ? null : money(row.balanceAfterDebitCents),
    balanceAfterCompletion: row.balanceAfterCompletionCents === null ? null : money(row.balanceAfterCompletionCents),
    createdAt: iso(row.assignedAt), assignedAt: iso(row.assignedAt), updatedAt: iso(row.updatedAt),
    acceptedAt: iso(row.acceptedAt), completedAt: iso(row.completedAt),
  };
}

export function referralCode() {
  return String(100000000 + Math.floor(Math.random() * 900000000));
}

export function requestFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function findCredentialUser(email: string) {
  const rows = await getDb().select({ credential: schema.credentials, user: schema.users })
    .from(schema.credentials).innerJoin(schema.users, eq(schema.credentials.userId, schema.users.id))
    .where(eq(schema.credentials.email, email.toLowerCase())).limit(1);
  return rows[0];
}

export async function markDepositNotifications(depositId: number, userId: number, amount: number) {
  await notifyAdmins("New deposit request", `Customer #${userId} submitted a $${amount.toFixed(2)} deposit request #${depositId} for review.`);
}

export async function getOrderWithSeller(orderId: number) {
  const rows = await getDb().select({ order: schema.orders, sellerOrderId: schema.sellerOrders.id })
    .from(schema.orders).leftJoin(schema.sellerOrders, eq(schema.sellerOrders.customerOrderId, schema.orders.id))
    .where(eq(schema.orders.id, orderId)).limit(1);
  return rows[0];
}

export async function ownedSellerOrder(sellerOrderId: number, userId: number) {
  const rows = await getDb().select().from(schema.sellerOrders)
    .where(and(eq(schema.sellerOrders.id, sellerOrderId), eq(schema.sellerOrders.sellerId, userId))).limit(1);
  return rows[0];
}
