/**
 * Smoke test: verify PGlite + Prisma setup works end-to-end with native types.
 *
 * Run:  bun run scripts/smoke-test-db.ts
 */
import { db, getDb } from "../src/lib/db";

async function main() {
  console.log("🧪 Starting smoke test...");
  const client = await getDb();

  // 1. Count users
  const userCount = await client.user.count();
  console.log(`✓ user.count() = ${userCount}`);

  // 2. Find customer with array+json fields
  const customer = await client.user.findUnique({
    where: { email: "customer@demo.ru" },
  });
  if (!customer) throw new Error("customer not found");
  console.log(`✓ user.findUnique()`);
  console.log(`  - roles (UserRole[]): ${JSON.stringify(customer.roles)}`);
  console.log(`  - loyaltyLevel (enum): ${customer.loyaltyLevel}`);
  console.log(`  - accountType (enum): ${customer.accountType}`);

  // 3. Find confectioner with deeply nested Json + String[]
  const confectioner = await client.confectioner.findUnique({
    where: { slug: "sladkaya-uezdnaya" },
  });
  if (!confectioner) throw new Error("confectioner not found");
  console.log(`✓ confectioner.findUnique()`);
  console.log(`  - specialization (String[]): ${confectioner.specialization.join(", ")}`);
  console.log(`  - location.city (Json): ${confectioner.location.city}`);
  console.log(`  - location.deliveryCities (Json array): ${confectioner.location.deliveryCities.join(", ")}`);
  console.log(`  - ecoBadges (String[]): ${confectioner.ecoBadges.join(", ")}`);
  console.log(`  - trustLevel (enum): ${confectioner.trustLevel}`);
  console.log(`  - tariff (enum): ${confectioner.tariff}`);
  console.log(`  - taxMode (enum): ${confectioner.taxMode}`);
  console.log(`  - paymentSettings.acceptCard (Json): ${confectioner.paymentSettings?.acceptCard}`);

  // 4. Find product with native types
  const product = await client.product.findUnique({
    where: { slug: "conditeray-klassicheskiy" },
  });
  if (!product) throw new Error("product not found");
  console.log(`✓ product.findUnique()`);
  console.log(`  - images (String[]): ${product.images.length} image(s)`);
  console.log(`  - tags (String[]): ${product.tags.join(", ")}`);
  console.log(`  - fillings[0].name (Json): ${product.fillings?.[0]?.name}`);

  // 5. Test PostgreSQL array query (has some)
  const cakeProductsWithBerries = await client.product.findMany({
    where: { tags: { has: "ягоды" } },
  });
  console.log(`✓ product.findMany({ tags: { has: 'ягоды' } }) = ${cakeProductsWithBerries.length} match(es)`);

  // 6. Test enum filter
  const goldCustomers = await client.user.findMany({
    where: { loyaltyLevel: "GOLD" },
  });
  console.log(`✓ user.findMany({ loyaltyLevel: 'GOLD' }) = ${goldCustomers.length} match(es)`);

  // 7. Create + read back to verify Json + String[] round-trip
  const newProduct = await client.product.create({
    data: {
      title: "Smoke Test Cake",
      slug: "smoke-test-cake-" + Date.now(),
      description: "Temporary product for smoke test",
      price: 1000,
      category: "cakes",
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      confectionerId: confectioner.id,
      tags: ["test", "smoke"],
      fillings: [{ name: "Test filling", priceModifier: 100 }],
      coatings: [{ name: "Test coating", priceModifier: 0 }],
      paymentOptions: { acceptCard: true, acceptSbp: false },
    },
  });
  console.log(`✓ product.create() with native types`);
  console.log(`  - images count: ${newProduct.images.length}`);
  console.log(`  - tags count: ${newProduct.tags.length}`);
  console.log(`  - fillings count: ${newProduct.fillings?.length}`);
  console.log(`  - paymentOptions.acceptCard: ${newProduct.paymentOptions?.acceptCard}`);

  // Cleanup
  await client.product.delete({ where: { id: newProduct.id } });
  console.log(`✓ product.delete() — cleanup done`);

  console.log("\n🎉 All smoke tests passed! PostgreSQL (PGlite) + native types working.");
  await client.$disconnect();
}

main().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
