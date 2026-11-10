import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { COUNTRIES } from "@contracts/countries";
import { hashPassword, verifyPassword, startSession, endSession, publicUser, referralCode, actor } from "../market/utils";

export const marketAuthRoutes = new Hono();

const email = z.string().trim().toLowerCase().email().max(320);
const password = z.string().min(8).max(200);

async function setupRequired() {
  const rows = await getDb().select({ id: schema.credentials.id }).from(schema.credentials)
    .innerJoin(schema.users, eq(schema.credentials.userId, schema.users.id))
    .where(eq(schema.users.role, "admin")).limit(1);
  return rows.length === 0;
}

marketAuthRoutes.get("/config", async (c) => {
  return c.json({
    setupRequired: await setupRequired(),
    payments: { wallet: true, cod: true, card: false, online: false, manualAssistance: true },
    availableCountries: ["United States"],
    countries: COUNTRIES,
    unavailableMessage: "This product is currently unavailable in your country. Please contact the administrator for manual order assistance.",
    depositMessage: "Please contact the administrator to make a deposit.",
  });
});

marketAuthRoutes.get("/session", async (c) => {
  const user = await actor(c);
  return c.json({ authenticated: Boolean(user) });
});

marketAuthRoutes.post("/setup", async (c) => {
  const input = z.object({ name: z.string().trim().min(2).max(160), email, password, confirm: password }).safeParse(await c.req.json().catch(() => null));
  if (!input.success || input.data.password !== input.data.confirm) return c.json({ error: "Enter a valid name/email and matching passwords of at least 8 characters." }, 400);
  if (!(await setupRequired())) return c.json({ error: "Administrator setup is already complete." }, 409);
  const db = getDb();
  const existing = await db.select({ id: schema.credentials.id }).from(schema.credentials).where(eq(schema.credentials.email, input.data.email)).limit(1);
  if (existing.length) return c.json({ error: "That email is already registered." }, 409);
  const id = await db.transaction(async (tx) => {
    const [{ id }] = await tx.insert(schema.users).values({
      unionId: `local:${randomUUID()}`, name: input.data.name, email: input.data.email,
      role: "admin", status: "active", lastSignInAt: new Date(),
    }).$returningId();
    await tx.insert(schema.credentials).values({ userId: id, email: input.data.email, passwordHash: hashPassword(input.data.password) });
    await tx.insert(schema.wallets).values({ userId: id, balanceCents: 0 });
    return id;
  });
  return c.json({ ok: true, id }, 201);
});

marketAuthRoutes.post("/register", async (c) => {
  const input = z.object({ name: z.string().trim().min(2).max(160), email, password, refcode: z.string().trim().regex(/^\d{9}$/).optional().or(z.literal("")) }).safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "All fields are required. Password must be at least 8 characters and referral codes must contain 9 digits." }, 400);
  const db = getDb();
  const duplicate = await db.select({ id: schema.credentials.id }).from(schema.credentials).where(eq(schema.credentials.email, input.data.email)).limit(1);
  if (duplicate.length) return c.json({ error: "Email already registered." }, 409);
  let referrer: typeof schema.users.$inferSelect | undefined;
  if (input.data.refcode) {
    referrer = await db.query.users.findFirst({ where: eq(schema.users.referralCode, input.data.refcode) });
    if (!referrer || referrer.status !== "active") return c.json({ error: "This referral code is invalid or inactive." }, 400);
  }
  try {
    const id = await db.transaction(async (tx) => {
      let code = referralCode();
      for (let i = 0; i < 5; i++) {
        const clash = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.referralCode, code)).limit(1);
        if (!clash.length) break;
        code = referralCode();
      }
      const [{ id }] = await tx.insert(schema.users).values({
        unionId: `local:${randomUUID()}`, name: input.data.name, email: input.data.email,
        role: "user", status: "active", referralCode: code,
        referredBy: referrer?.id, referredAt: referrer ? new Date() : null,
      }).$returningId();
      await tx.insert(schema.credentials).values({ userId: id, email: input.data.email, passwordHash: hashPassword(input.data.password) });
      await tx.insert(schema.wallets).values({ userId: id, balanceCents: 0 });
      if (referrer) await tx.insert(schema.notifications).values({ userId: referrer.id, title: "New alliance referral", message: `${input.data.name} joined MarketZone using your referral code.` });
      return id;
    });
    return c.json({ ok: true, id }, 201);
  } catch {
    return c.json({ error: "Registration could not be completed. Please check your details and try again." }, 409);
  }
});

marketAuthRoutes.post("/login", async (c) => {
  const input = z.object({ email, password: z.string().min(1).max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "Invalid email or password." }, 400);
  const row = await getDb().select({ credential: schema.credentials, user: schema.users }).from(schema.credentials)
    .innerJoin(schema.users, eq(schema.credentials.userId, schema.users.id))
    .where(eq(schema.credentials.email, input.data.email)).limit(1);
  if (!row[0] || !verifyPassword(input.data.password, row[0].credential.passwordHash)) return c.json({ error: "Invalid email or password." }, 401);
  if (row[0].user.status !== "active") return c.json({ error: "This account has been banned by the administrator." }, 403);
  await getDb().update(schema.users).set({ lastSignInAt: new Date() }).where(eq(schema.users.id, row[0].user.id));
  await startSession(c, row[0].user);
  return c.json({ ok: true, user: publicUser(row[0].user, true) });
});

marketAuthRoutes.post("/logout", (c) => {
  endSession(c);
  return c.json({ ok: true });
});
