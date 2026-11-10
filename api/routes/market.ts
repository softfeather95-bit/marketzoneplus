import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { marketAuthRoutes } from "./market-auth";
import { marketStateRoutes } from "./market-state";
import { marketCustomerRoutes } from "./market-customer";
import { marketAdminRoutes } from "./market-admin";
import { AuthError } from "../market/utils";
import { log } from "../lib/logger";

export const marketRoutes = new Hono();

const documentLimit = bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => c.json({ error: "The verification document exceeds the 2.5 MB limit." }, 413) });
marketRoutes.use("/customer/stores", documentLimit);
marketRoutes.use("/admin/stores", documentLimit);
marketRoutes.route("/auth", marketAuthRoutes);
marketRoutes.route("/", marketStateRoutes);
marketRoutes.route("/customer", marketCustomerRoutes);
marketRoutes.route("/admin", marketAdminRoutes);

marketRoutes.onError((error, c) => {
  if (error instanceof AuthError) return c.json({ error: error.message }, error.status as 401 | 403);
  log.error("marketplace request failed", { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  return c.json({ error: "The operation could not be completed. No success was confirmed." }, 500);
});
