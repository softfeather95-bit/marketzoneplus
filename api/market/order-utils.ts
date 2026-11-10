import { eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { FROZEN_ACCOUNT_MESSAGE } from "./utils";
import type { getDb } from "../queries/connection";

type MarketDatabase = ReturnType<typeof getDb>;
export type MarketTransaction = Parameters<Parameters<MarketDatabase["transaction"]>[0]>[0];

/** Recheck the selected account under a row lock immediately before a restricted mutation. */
export async function assertAccountNotFrozen(tx: MarketTransaction, userId: number) {
  const rows = await tx.select({ withdrawHold: schema.users.withdrawHold }).from(schema.users).where(eq(schema.users.id, userId)).for("update");
  if (rows[0]?.withdrawHold) throw new Error(FROZEN_ACCOUNT_MESSAGE);
}

/** Apply a balance change inside the caller's transaction, creating missing wallets safely. */
export async function changeWallet(tx: MarketTransaction, userId: number, deltaCents: number) {
  const rows = await tx.select().from(schema.wallets).where(eq(schema.wallets.userId, userId)).for("update");
  const before = rows[0]?.balanceCents || 0;
  const after = before + deltaCents;
  if (after < 0) throw new Error("Insufficient wallet balance for this operation.");
  if (rows[0]) await tx.update(schema.wallets).set({ balanceCents: after }).where(eq(schema.wallets.userId, userId));
  else await tx.insert(schema.wallets).values({ userId, balanceCents: after });
  return { before, after };
}

/** Return an accepted seller order's principal exactly once. The seller row must already be locked. */
export async function returnSellerPrincipal(tx: MarketTransaction, order: typeof schema.sellerOrders.$inferSelect) {
  if (order.deductedCents <= 0 || order.returnedCents === order.deductedCents) return { amount: 0, balance: null as number | null };
  if (order.returnedCents !== 0) throw new Error("The seller-order principal is in an inconsistent return state.");
  const wallet = await changeWallet(tx, order.sellerId, order.deductedCents);
  await tx.insert(schema.transactions).values({
    userId: order.sellerId,
    type: "order_return",
    amountCents: order.deductedCents,
    note: `Principal returned — Order ORD-${order.id}`,
    orderId: order.customerOrderId,
  });
  await tx.update(schema.sellerOrders).set({ returnedCents: order.deductedCents }).where(eq(schema.sellerOrders.id, order.id));
  return { amount: order.deductedCents, balance: wallet.after };
}

/** Restore item stock exactly once for a locked, cancelled order. */
export async function restoreOrderStock(tx: MarketTransaction, order: typeof schema.orders.$inferSelect) {
  if (order.stockRestored) return;
  const quantities = new Map<number, number>();
  for (const item of order.items || []) {
    const productId = Number(item.productId);
    const qty = Number(item.qty);
    if (Number.isInteger(productId) && productId > 0 && Number.isInteger(qty) && qty > 0) {
      quantities.set(productId, (quantities.get(productId) || 0) + qty);
    }
  }
  if (quantities.size) {
    const rows = await tx.select().from(schema.products).where(inArray(schema.products.id, [...quantities.keys()])).for("update");
    for (const product of rows) {
      await tx.update(schema.products).set({ stock: product.stock + quantities.get(product.id)! }).where(eq(schema.products.id, product.id));
    }
  }
  await tx.update(schema.orders).set({ stockRestored: true }).where(eq(schema.orders.id, order.id));
}
