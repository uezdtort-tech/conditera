#!/usr/bin/env node
/**
 * Test-only fixture for browser E2E checkout.
 *
 * This is deliberately NOT part of production migrations or the normal DB seed.
 * It creates one explicitly named E2E product with a published recipe and
 * sufficient existing demo inventory so the browser can exercise the real
 * checkout/acceptance gate without inventing production confectioner data.
 */
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL || process.env.PGURL;
if (!connectionString) {
  throw new Error("DATABASE_URL or PGURL is required for the E2E orderable-product fixture");
}

const client = new Client({ connectionString });
const productSlug = "e2e-orderable-demo-cake";
const recipeSlug = "e2e-orderable-demo-cake-recipe";
const productTitle = "E2E демо-торт (тестовый товар)";

async function main() {
  await client.connect();
  await client.query("BEGIN");
  try {
    const owner = await client.query(
      "SELECT id::text FROM public.profiles WHERE email = $1 LIMIT 1",
      ["confectioner@demo.ru"]
    );
    if (owner.rowCount !== 1) throw new Error("Demo confectioner profile is missing");
    const ownerId = owner.rows[0].id;

    const category = await client.query(
      "SELECT id::text FROM public.product_categories WHERE slug = $1 LIMIT 1",
      ["cakes"]
    );
    if (category.rowCount !== 1) throw new Error("Product category 'cakes' is missing");

    const inventory = await client.query(
      `SELECT id::text, name
         FROM public.inventory_items
        WHERE owner_id = $1::uuid
          AND is_active = true
          AND name = ANY($2::text[])`,
      [
        ownerId,
        ["Мука пшеничная в/с", "Сливки 33-35%", "Шоколад тёмный 70%", "Сахар-песок"],
      ]
    );
    const inventoryByName = new Map(inventory.rows.map((row) => [row.name, row.id]));
    const requiredInventory = ["Мука пшеничная в/с", "Сливки 33-35%", "Шоколад тёмный 70%", "Сахар-песок"];
    const missing = requiredInventory.filter((name) => !inventoryByName.has(name));
    if (missing.length) throw new Error(`Required demo inventory is missing: ${missing.join(", ")}`);

    const recipe = await client.query(
      `INSERT INTO public.recipes
         (author_id, title, description, content, difficulty, servings, slug, status, published_at)
       VALUES
         ($1::uuid, $2, $3, $4, 'easy', 8, $5, 'published', now())
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         content = EXCLUDED.content,
         status = 'published',
         published_at = now()
       RETURNING id::text`,
      [
        ownerId,
        "E2E demo cake recipe",
        "Synthetic recipe used only by automated browser tests; not a production recipe.",
        "## Ingredients\n\nFlour, cream, dark chocolate, sugar.\n\n## Steps\n\n1. Mix ingredients.\n2. Bake and cool.\n3. Finish and package.",
        recipeSlug,
      ]
    );
    const recipeId = recipe.rows[0].id;

    await client.query("DELETE FROM public.recipe_ingredients WHERE recipe_id = $1::uuid", [recipeId]);
    const ingredients = [
      ["Мука", 0.2, "кг", "Мука пшеничная в/с", 10],
      ["Сливки", 0.1, "л", "Сливки 33-35%", 20],
      ["Шоколад", 0.05, "кг", "Шоколад тёмный 70%", 30],
      ["Сахар", 0.1, "кг", "Сахар-песок", 40],
    ];
    for (const [name, quantity, unit, inventoryName, sortOrder] of ingredients) {
      await client.query(
        `INSERT INTO public.recipe_ingredients
           (recipe_id, name, qty, unit, inventory_item_id, sort_order)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6)`,
        [recipeId, name, quantity, unit, inventoryByName.get(inventoryName), sortOrder]
      );
    }

    const product = await client.query(
      `INSERT INTO public.products
         (confectioner_id, category_id, slug, title, description, price, status,
          is_featured, published_at, recipe_id, min_order_qty, custom_order_available,
          is_available, production_time_hours,
          product_type, weight_grams, servings, tags)
       VALUES
         ($1::uuid, $2::uuid, $3, $4, $5, 4400, 'published',
          false, now(), $6::uuid, 1, false, true, 4,
          'cake', 1200, 8, ARRAY['e2e','demo'])
       ON CONFLICT (slug) DO UPDATE SET
         confectioner_id = EXCLUDED.confectioner_id,
         category_id = EXCLUDED.category_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         price = EXCLUDED.price,
         status = 'published',
         published_at = now(),
         recipe_id = EXCLUDED.recipe_id,
         min_order_qty = 1,
         custom_order_available = false,
         is_available = true,
         production_time_hours = 4,
         product_type = 'cake',
         weight_grams = 1200,
         servings = 8,
         tags = ARRAY['e2e','demo']
       RETURNING id::text`,
      [
        ownerId,
        category.rows[0].id,
        productSlug,
        productTitle,
        "Тестовая карточка для проверки оформления заказа в браузере. Не является реальным товаром.",
        recipeId,
      ]
    );

    await client.query("COMMIT");
    process.stdout.write(`E2E orderable product seeded: ${product.rows[0].id} (${productTitle})\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`E2E orderable-product fixture failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
