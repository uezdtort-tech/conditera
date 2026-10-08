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

  // 2. Рецепт — ВСЕГДА детерминированный демо-рецепт по slug (P1.1 §4).
  //    Раньше брался «первый попавшийся published» (ORDER BY published,
  //    created_at) — на живой БД ингредиенты льются в произвольный рецепт.
  //    ON CONFLICT DO UPDATE — содержимое стабильно на всех прогонах.
  await client.query(
    `INSERT INTO public.recipes (author_id, title, description, content, difficulty, servings, slug, status, published_at)
     VALUES ($1::uuid, $2, $3, $4, 'easy', 8, $5, 'published', now())
     ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content`,
    [
      ownerId,
      DEMO_RECIPE.title,
      "Демо-рецепт для связки товаров и структурированных ингредиентов (ops-center).",
      DEMO_RECIPE.content,
      DEMO_RECIPE.slug,
    ]
  );
  const recipeRes = await client.query(`SELECT id::text, slug, title FROM public.recipes WHERE slug = $1`, [
    DEMO_RECIPE.slug,
  ]);
  if (recipeRes.rowCount === 0) return;
  const recipe = recipeRes.rows[0];

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

  // 4. Связь товаров с ДЕМО-рецептом — детерминированная (P1.1 §4):
  //    перелинковываем всегда, а не только при NULL — иначе на живой БД
  //    продукт остаётся прицеплен к произвольному рецепту прошлых прогонов.
  const linked = await client.query(
    `UPDATE public.products SET recipe_id = $1::uuid, updated_at = now()
     WHERE slug = ANY($2::text[]) AND (recipe_id IS NULL OR recipe_id <> $1::uuid)`,
    [recipe.id, DEMO_PRODUCT_SLUGS]
  );

  const ingCount = await client.query(
    `SELECT count(*)::int AS c FROM public.recipe_ingredients WHERE recipe_id = $1::uuid`,
    [recipe.id]
  );

  // 4. Демо-заказ DEMO-1048 — детерминированный fixture для P0/P0.5/P1
  //    регрессий (P1.1 §4: тесты не зависят от «заказа прошлой сессии»).
  //    Каждая пересидка ОБНОВЛЯЕТ его: delivery_date=CURRENT_DATE (иначе
  //    «Заказы сегодня» устаревают через сутки), статус/paid_at
  //    восстанавливаются (verify-скрипты мутируют заказ в PREPARING).
  const demoProduct = await client.query(
    `SELECT id::text, price, title FROM public.products WHERE slug = $1 LIMIT 1`,
    [DEMO_PRODUCT_SLUGS[0]]
  );
  let demoOrders = 0;
  if (demoProduct.rowCount > 0) {
    const unit = Number(demoProduct.rows[0].price) || 18500;
    const total = unit * 2; // 2 × «Ягодный бархат» = 37 000 ₽ (контракт verify)
    const ins = await client.query(
      `INSERT INTO public.orders
         (number, user_id, confectioner_id, subtotal, delivery_cost, discount, total,
          status, payment_status, payment_method, delivery_address, delivery_city,
          delivery_date, delivery_time_window, delivery_type, metadata, paid_at, confirmed_at)
       VALUES ('DEMO-1048', '11111111-1111-4111-8111-111111111106', $1::uuid,
               $2, 0, 0, $2, 'CONFIRMED', 'escrow', 'card',
               'ул. Демо, 1', 'Москва', CURRENT_DATE, '15:00-18:00', 'delivery',
               jsonb_build_object('test','demo','fixture','ops-center'),
               now(), now())
       ON CONFLICT (number) DO UPDATE SET
         status = 'CONFIRMED',
         payment_status = 'escrow',
         paid_at = now(),
         confirmed_at = now(),
         delivery_date = CURRENT_DATE,
         delivery_time_window = '15:00-18:00',
         total = $2,
         subtotal = $2,
         updated_at = now()`,
      [ownerId, total]
    );
    demoOrders = ins.rowCount ?? 0;
    await client.query(
      `INSERT INTO public.order_items
         (order_id, product_id, product_title, quantity, unit_price, total)
       SELECT o.id, p.id, p.title, 2, p.price, p.price * 2
       FROM public.orders o CROSS JOIN public.products p
       WHERE o.number = 'DEMO-1048' AND p.slug = $1
         AND NOT EXISTS (
           SELECT 1 FROM public.order_items oi
           WHERE oi.order_id = o.id AND oi.product_id = p.id
         )`,
      [DEMO_PRODUCT_SLUGS[0]]
    );
  }

  // 5. Демо-значения времени производства (P1 фикс, восстановлен P1.1 §4 —
  //    правка была сделана через API в старой БД и потерялась при сбросе):
  //    быстрые позиции — 6 ч, сложная 3D-скульптура — 12 ч. Свадебный торт
  //    остаётся NULL (оценка по рецепту/дефолту — так golden path не ловит
  //    CAPACITY_EXCEEDED на узком окне).
  await client.query(
    `UPDATE public.products SET production_time_hours = v.hrs, updated_at = now()
     FROM (VALUES
       ('bento-tort-nezhnyy', 6),
       ('kapkeyki-vanilnyye-12', 6),
       ('tort-korovka-3d', 12)
     ) AS v(slug, hrs)
     WHERE products.slug = v.slug AND products.production_time_hours IS DISTINCT FROM v.hrs`
  );

  console.log(
    `    ops-center: recipe "${recipe.title}" (${recipe.id}), ingredients=${ingCount.rows[0]?.c ?? 0}, products linked=${linked.rowCount}, demo order DEMO-1048=${demoOrders ? "refreshed" : "skipped (нет товара)"}`
  );
}
