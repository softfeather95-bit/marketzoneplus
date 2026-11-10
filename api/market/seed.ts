import { inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { products } from "@db/schema";
import { catalogSeed } from "./catalog-seed";
import { cents } from "./utils";

let ready: Promise<void> | null = null;

async function seed() {
  const db = getDb();
  const ids = catalogSeed.map((p) => p.id);
  if (!ids.length) return;
  const existing = await db.select({ id: products.id }).from(products).where(inArray(products.id, ids));
  const present = new Set(existing.map((p) => p.id));
  const missing = catalogSeed.filter((p) => !present.has(p.id));
  for (let i = 0; i < missing.length; i += 50) {
    await db.insert(products).values(missing.slice(i, i + 50).map((p) => ({
      id: p.id, sku: p.sku, name: p.name, brand: p.brand, category: p.category,
      subcategory: p.subcategory, description: p.description,
      priceCents: cents(p.price), mrpCents: cents(p.mrp), discountPercent: p.discountPercent,
      stock: p.stock, image: p.image, images: p.images,
      data: { ...p }, storeId: null,
    })));
  }
}

export function ensureCatalogSeed() {
  if (!ready) ready = seed().catch((error) => { ready = null; throw error; });
  return ready;
}
