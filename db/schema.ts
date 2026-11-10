import {
  mysqlTable,
  mysqlEnum,
  varchar,
  text,
  mediumtext,
  timestamp,
  bigint,
  int,
  boolean,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  status: mysqlEnum("status", ["active", "banned"]).default("active").notNull(),
  referralCode: varchar("referralCode", { length: 9 }),
  referredBy: bigint("referredBy", { mode: "number", unsigned: true }),
  referredAt: timestamp("referredAt"),
  withdrawHold: boolean("withdrawHold").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export const credentials = mysqlTable("credentials", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: text("passwordHash").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const stores = mysqlTable("stores", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().unique().references(() => users.id, { onDelete: "restrict" }),
  storeName: varchar("storeName", { length: 180 }).notNull(),
  category: varchar("category", { length: 120 }).notNull(),
  description: text("description").notNull(),
  gender: mysqlEnum("gender", ["Male", "Female"]).notNull(),
  country: varchar("country", { length: 100 }).notNull(),
  dialingCode: varchar("dialingCode", { length: 8 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  docType: varchar("docType", { length: 80 }).notNull(),
  docImage: mediumtext("docImage"),
  refCode: varchar("refCode", { length: 9 }),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  rejectReason: text("rejectReason"),
  creditScore: int("creditScore").default(100).notNull(),
  rating: varchar("rating", { length: 3 }).default("5.0").notNull(),
  visitors: int("visitors").default(0).notNull(),
  views: int("views").default(0).notNull(),
  metricsSource: varchar("metricsSource", { length: 30 }).default("admin_configured").notNull(),
  ownerName: varchar("ownerName", { length: 160 }),
  houseNumber: varchar("houseNumber", { length: 40 }),
  street: varchar("street", { length: 180 }),
  apartment: varchar("apartment", { length: 80 }),
  city: varchar("city", { length: 120 }),
  state: varchar("state", { length: 120 }),
  zip: varchar("zip", { length: 30 }),
  officeCountry: varchar("officeCountry", { length: 100 }),
  productIds: json("productIds").$type<number[]>().notNull(),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  index("stores_status_idx").on(table.status),
  index("stores_name_idx").on(table.storeName),
]);

export const products = mysqlTable("products", {
  id: int("id").primaryKey(),
  sku: varchar("sku", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 300 }).notNull(),
  brand: varchar("brand", { length: 160 }).notNull(),
  category: varchar("category", { length: 120 }).notNull(),
  subcategory: varchar("subcategory", { length: 160 }).notNull(),
  description: text("description").notNull(),
  priceCents: int("priceCents").notNull(),
  mrpCents: int("mrpCents").notNull(),
  discountPercent: int("discountPercent").notNull(),
  stock: int("stock").notNull(),
  image: text("image").notNull(),
  images: json("images").$type<string[]>().notNull(),
  data: json("data").$type<Record<string, unknown>>().notNull(),
  storeId: bigint("storeId", { mode: "number", unsigned: true }).references(() => stores.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  index("products_category_idx").on(table.category),
  index("products_store_idx").on(table.storeId),
]);

export const wallets = mysqlTable("wallets", {
  userId: bigint("userId", { mode: "number", unsigned: true }).primaryKey().references(() => users.id, { onDelete: "cascade" }),
  balanceCents: bigint("balanceCents", { mode: "number" }).default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const orders = mysqlTable("orders", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  manual: boolean("manual").default(false).notNull(),
  status: varchar("status", { length: 40 }).default("Pending").notNull(),
  totalCents: int("totalCents").notNull(),
  shippingCents: int("shippingCents").default(0).notNull(),
  paymentMethod: varchar("paymentMethod", { length: 50 }).notNull(),
  address: text("address").notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),
  country: varchar("country", { length: 100 }).notNull(),
  items: json("items").$type<Array<Record<string, unknown>>>().notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 100 }),
  refundIssued: boolean("refundIssued").default(false).notNull(),
  stockRestored: boolean("stockRestored").default(false).notNull(),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  completedAt: timestamp("completedAt"),
}, (table) => [
  uniqueIndex("orders_idempotency_idx").on(table.idempotencyKey),
  index("orders_user_idx").on(table.userId),
  index("orders_status_idx").on(table.status),
]);

export const sellerOrders = mysqlTable("sellerOrders", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  customerOrderId: bigint("customerOrderId", { mode: "number", unsigned: true }).notNull().unique().references(() => orders.id, { onDelete: "cascade" }),
  storeId: bigint("storeId", { mode: "number", unsigned: true }).notNull().references(() => stores.id, { onDelete: "restrict" }),
  sellerId: bigint("sellerId", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  productId: int("productId").notNull(),
  productName: varchar("productName", { length: 300 }).notNull(),
  productImage: text("productImage").notNull(),
  quantity: int("quantity").default(1).notNull(),
  amountCents: int("amountCents").notNull(),
  profitCents: int("profitCents").default(0).notNull(),
  status: varchar("status", { length: 50 }).default("Awaiting Acceptance").notNull(),
  eta: varchar("eta", { length: 60 }).notNull(),
  instructions: text("instructions"),
  history: json("history").$type<Array<Record<string, unknown>>>().notNull(),
  profitCredited: boolean("profitCredited").default(false).notNull(),
  profitStatus: varchar("profitStatus", { length: 30 }).default("").notNull(),
  deductedCents: int("deductedCents").default(0).notNull(),
  returnedCents: int("returnedCents").default(0).notNull(),
  balanceAfterDebitCents: int("balanceAfterDebitCents"),
  balanceAfterCompletionCents: int("balanceAfterCompletionCents"),
  acceptedAt: timestamp("acceptedAt"),
  completedAt: timestamp("completedAt"),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  index("seller_orders_store_idx").on(table.storeId),
  index("seller_orders_seller_idx").on(table.sellerId),
]);

export const transactions = mysqlTable("transactions", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(),
  amountCents: bigint("amountCents", { mode: "number" }).notNull(),
  note: text("note").notNull(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("transactions_user_idx").on(table.userId)]);

export const deposits = mysqlTable("deposits", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "cascade" }),
  amountCents: int("amountCents").notNull(),
  reference: varchar("reference", { length: 160 }).default("").notNull(),
  status: mysqlEnum("status", ["Pending", "Approved", "Rejected"]).default("Pending").notNull(),
  processedBy: bigint("processedBy", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("deposits_user_idx").on(table.userId)]);

export const notifications = mysqlTable("notifications", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 220 }).notNull(),
  message: text("message").notNull(),
  read: boolean("read").default(false).notNull(),
  soId: bigint("soId", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("notifications_user_idx").on(table.userId)]);

export const withdrawals = mysqlTable("withdrawals", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "cascade" }),
  amountCents: int("amountCents").notNull(),
  method: varchar("method", { length: 40 }).notNull(),
  destination: text("destination").notNull(),
  storeName: varchar("storeName", { length: 180 }).default("").notNull(),
  status: mysqlEnum("status", ["Pending", "Completed", "Rejected"]).default("Pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
});

export const assistanceRequests = mysqlTable("manualAssistanceRequests", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "cascade" }),
  productId: int("productId"),
  country: varchar("country", { length: 100 }).notNull(),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["Pending", "Reviewed", "Resolved"]).default("Pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const referralCodes = mysqlTable("referralCodes", {
  code: varchar("code", { length: 9 }).primaryKey(),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "cascade" }),
  usedBy: bigint("usedBy", { mode: "number", unsigned: true }),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const auditLogs = mysqlTable("adminAuditLogs", {
  id: int("id").autoincrement().primaryKey(),
  adminId: bigint("adminId", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  entityType: varchar("entityType", { length: 60 }).notNull(),
  entityId: varchar("entityId", { length: 80 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  previousValue: json("previousValue"),
  newValue: json("newValue"),
  details: text("details").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("audit_entity_idx").on(table.entityType, table.entityId)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Store = typeof stores.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
