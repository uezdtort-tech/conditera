#!/usr/bin/env node
/**
 * scripts/db/seed-ops-center.mjs — демо-данные для ops-center P0 (Task 2-a).
 *
 * Вызывается из setup.mjs в цикле сидов как .mjs-сид:
 *   const mod = await import(pathToFileURL(seedFile).href);
 *   await mod.default({ client, ROOT });
 *
 * Контракт:
 *   - экспорт default async ({ client, ROOT });
 *   - НЕ открывает свою транзакцию — обёртка setup.mjs делает BEGIN/COMMIT;
 *   - идемпотентен (WHERE NOT EXISTS / UPDATE ... WHERE recipe_id IS NULL);
 *   - безопасен на пустой БД (нет демо-кондитера — тихий return).
 *
 * Данные:
 *   - владелец склада: confectioner@demo.ru (11111111-1111-4111-8111-111111111101),
 *     его inventory_items уже насыпаны compat/0003_seed_inventory.sql;
 *   - 1 демо-рецепт «Красный бархат (демо)» (если рецептов нет вообще);
 *   - 5 recipe_ingredients (Мука 450 г / Сливки 600 мл / Шоколад 300 г /
 *     Яйца 8 шт / Ягоды 250 г) с inventory_item_id по совпадению корня имени
 *     (Ягоды на складе нет → null);
 *   - связь products.recipe_id у демо-товара «Свадебный торт „Ягодный бархат"»;
 *   - ops_tasks/domain_events НЕ создаёт — их материализует rule engine.
 */

// Корни имён для маппинга recipe_ingredients → inventory_items (lower, вхождение)
const NAME_ROOTS = {
  "Мука": ["мука пшеничная", "мука"],
  "Сливки": ["сливки 33-35", "сливки"],
  "Шоколад": ["шоколад тёмный", "шоколад"],
  "Яйца": ["яйцо куриное", "яйц"],
  "Ягоды": ["ягод"],
};

const DEMO_RECIPE = {
  slug: "krasnyy-barhat-demo",
  title: "Красный бархат (демо)",
  content:
    "## Ингредиенты\n\nМука, сливки, шоколад, яйца, ягоды.\n\n## Шаги\n\n1. Замесите тесто.\n2. Выпекайте коржи 30 минут при 180°C.\n3. Прослоите сливочным кремом и украсьте ягодами.",
};

const RECIPE_INGREDIENTS = [
  { name: "Мука", qty: 450, unit: "г", sort: 10 },
  { name: "Сливки", qty: 600, unit: "мл", sort: 20 },
  { name: "Шоколад", qty: 300, unit: "г", sort: 30 },
  { name: "Яйца", qty: 8, unit: "шт", sort: 40 },
  { name: "Ягоды", qty: 250, unit: "г", sort: 50 },
];

// Демо-товары кондитера, к которым привязываем рецепт (только если recipe_id IS NULL)
const DEMO_PRODUCT_SLUGS = ["svadebnyy-tort-yagodnyy-barhat"];

export default async function seedOpsCenter({ client }) {
  // 1. Владелец склада — демо-кондитер
  const owner = await client.query(
    `SELECT id::text FROM public.profiles WHERE email = 'confectioner@demo.ru' LIMIT 1`
  );
  if (owner.rowCount === 0) {
    console.log("    ops-center: демо-кондитер не найден — сид пропущен (пустая БД)");
    return;
  }
  const ownerId = owner.rows[0].id;

  // 2. Рецепт: берём 1-2 существующих, иначе вставляем демо-рецепт
  let recipes = await client.query(
    `SELECT id::text, slug FROM public.recipes ORDER BY (status = 'published') DESC, created_at LIMIT 2`
  );
  if (recipes.rowCount === 0) {
    await client.query(
      `INSERT INTO public.recipes (author_id, title, description, content, difficulty, servings, slug, status, published_at)
       VALUES ($1::uuid, $2, $3, $4, 'easy', 8, $5, 'published', now())
       ON CONFLICT (slug) DO NOTHING`,
      [
        ownerId,
        DEMO_RECIPE.title,
        "Демо-рецепт для связки товаров и структурированных ингредиентов (ops-center).",
        DEMO_RECIPE.content,
        DEMO_RECIPE.slug,
      ]
    );
    recipes = await client.query(
      `SELECT id::text, slug FROM public.recipes ORDER BY (status = 'published') DESC, created_at LIMIT 2`
    );
  }
  const recipe = recipes.rows[0];
  if (!recipe) return;

  // 3. recipe_ingredients: 5 позиций, inventory_item_id по корню имени склада
  //    NB: lower() в БД (collation C) не фолдит кириллицу — приводим в JS
  const inventory = await client.query(
    `SELECT id::text, name FROM public.inventory_items WHERE owner_id = $1::uuid AND is_active`,
    [ownerId]
  );
  const invRows = inventory.rows.map((r) => ({ id: r.id, name: String(r.name).toLowerCase() }));

  const matchInventory = (label) => {
    for (const root of NAME_ROOTS[label] || []) {
      const hit = invRows.find((r) => r.name.includes(root));
      if (hit) return hit.id;
    }
    return null;
  };

  for (const ing of RECIPE_INGREDIENTS) {
    const invId = matchInventory(ing.name);
    await client.query(
      `INSERT INTO public.recipe_ingredients (recipe_id, name, qty, unit, inventory_item_id, sort_order)
       SELECT $1::uuid, $2, $3, $4, $5::uuid, $6
       WHERE NOT EXISTS (
         SELECT 1 FROM public.recipe_ingredients WHERE recipe_id = $1::uuid AND name = $2
       )`,
      [recipe.id, ing.name, ing.qty, ing.unit, invId, ing.sort]
    );
    // Дочинка: если позиция уже была вставлена без связи (ранний прогон сида) — привязываем
    if (invId) {
      await client.query(
        `UPDATE public.recipe_ingredients SET inventory_item_id = $3::uuid
         WHERE recipe_id = $1::uuid AND name = $2 AND inventory_item_id IS NULL`,
        [recipe.id, ing.name, invId]
      );
    }
  }

  // 4. Связь товаров с рецептом (только ещё не связанные демо-товары)
  const linked = await client.query(
    `UPDATE public.products SET recipe_id = $1::uuid, updated_at = now()
     WHERE slug = ANY($2::text[]) AND recipe_id IS NULL`,
    [recipe.id, DEMO_PRODUCT_SLUGS]
  );

  const ingCount = await client.query(
    `SELECT count(*)::int AS c FROM public.recipe_ingredients WHERE recipe_id = $1::uuid`,
    [recipe.id]
  );

  console.log(
    `    ops-center: recipe "${recipe.title}" (${recipe.id}), ingredients=${ingCount.rows[0]?.c ?? 0}, products linked=${linked.rowCount}`
  );
}
