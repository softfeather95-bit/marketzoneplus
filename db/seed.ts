import { ensureCatalogSeed } from "../api/market/seed";

async function seed() {
  console.log("Checking the 510-product MarketZone catalog...");
  await ensureCatalogSeed();
  console.log("Catalog seed complete.");
  process.exit(0);
}

seed().catch((error) => {
  console.error("Catalog seed failed:", error);
  process.exit(1);
});
