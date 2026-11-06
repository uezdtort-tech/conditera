/**
 * Z-v13: изолированные тестовые фикстуры для E2E (префикс zv13_ / ZV13-).
 * Только INSERT новых строк с однозначными идентификаторами; существующие
 * данные не изменяются и не удаляются. Очистка — scripts/zv13-cleanup.mjs.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();

const CONF0_USER = "11111111-1111-4111-8111-111111111101"; // confectioner@demo.ru (con0, approved)
const CUSTOMER_USER = "11111111-1111-4111-8111-111111111106"; // customer@demo.ru

const c = new Client({ connectionString: url });
await c.connect();

// Адресная зачистка СВОИХ предыдущих неполных запусков (только ZV13-фикстуры)
await c.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE number LIKE 'ZV13-%')`);
await c.query(`DELETE FROM orders WHERE number LIKE 'ZV13-%'`);
await c.query(`DELETE FROM products WHERE slug LIKE 'zv13-product-%'`);
await c.query(`DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT id FROM recipes WHERE slug LIKE 'zv13-recipe-%')`);
await c.query(`DELETE FROM recipes WHERE slug LIKE 'zv13-recipe-%'`);
await c.query(`DELETE FROM inventory_items WHERE name LIKE 'ZV13_%'`);

// Тип заказа и адрес — по образцу существующих данных (без выдуманных enum-значений)
const typeRow = await c.query(
  `SELECT type, delivery_type, delivery_city FROM orders WHERE type IS NOT NULL ORDER BY created_at DESC LIMIT 1`
);
const ORD_TYPE = typeRow.rows[0]?.type ?? null;
const ORD_DELIVERY_TYPE = typeRow.rows[0]?.delivery_type ?? null;
const ORD_CITY = typeRow.rows[0]?.delivery_city ?? "Москва";

const invA = await c.query(
  `INSERT INTO inventory_items (owner_id, name, category, quantity, unit, min_quantity, cost_per_unit, supplier, is_active)
   VALUES ($1,'ZV13_Мука пшеничная','Ингредиенты',50,'кг',1,50,'ZV13 Поставщик',true) RETURNING id::text`,
  [CONF0_USER]
);
const invB = await c.query(
  `INSERT INTO inventory_items (owner_id, name, category, quantity, unit, min_quantity, cost_per_unit, supplier, is_active)
   VALUES ($1,'ZV13_Сахар мелкий','Ингредиенты',2000,'г',100,100,'ZV13 Поставщик',true) RETURNING id::text`,
  [CONF0_USER]
);
const invC = await c.query(
  `INSERT INTO inventory_items (owner_id, name, category, quantity, unit, min_quantity, cost_per_unit, supplier, is_active)
   VALUES ($1,'ZV13_Масло сливочное','Ингредиенты',10,'кг',1,300,'ZV13 Поставщик',true) RETURNING id::text`,
  [CONF0_USER]
);
const [INV_A, INV_B, INV_C] = [invA.rows[0].id, invB.rows[0].id, invC.rows[0].id];

// Рецепты: A — всё в наличии; B — shortage (10×500г=5000г > 2000г); C — unit_mismatch (л vs кг)
const recA = await c.query(
  `INSERT INTO recipes (author_id, title, description, content, difficulty, prep_time_minutes, cook_time_minutes, servings, status, slug)
   VALUES ($1,'ZV13_Рецепт A (полный запас)','Z-v13 fixture','Z-v13 fixture content','easy',10,20,1,'published','zv13-recipe-a') RETURNING id::text`,
  [CONF0_USER]
);
const recB = await c.query(
  `INSERT INTO recipes (author_id, title, description, content, difficulty, prep_time_minutes, cook_time_minutes, servings, status, slug)
   VALUES ($1,'ZV13_Рецепт B (нехватка)','Z-v13 fixture','Z-v13 fixture content','easy',10,20,1,'published','zv13-recipe-b') RETURNING id::text`,
  [CONF0_USER]
);
const recC = await c.query(
  `INSERT INTO recipes (author_id, title, description, content, difficulty, prep_time_minutes, cook_time_minutes, servings, status, slug)
   VALUES ($1,'ZV13_Рецепт C (единицы)','Z-v13 fixture','Z-v13 fixture content','easy',10,20,1,'published','zv13-recipe-c') RETURNING id::text`,
  [CONF0_USER]
);
const [REC_A, REC_B, REC_C] = [recA.rows[0].id, recB.rows[0].id, recC.rows[0].id];

await c.query(
  `INSERT INTO recipe_ingredients (recipe_id, name, qty, unit, inventory_item_id, sort_order)
   VALUES ($1,'ZV13_Мука пшеничная',100,'г',$2,1)`,
  [REC_A, INV_A]
);
await c.query(
  `INSERT INTO recipe_ingredients (recipe_id, name, qty, unit, inventory_item_id, sort_order)
   VALUES ($1,'ZV13_Сахар мелкий',500,'г',$2,1)`,
  [REC_B, INV_B]
);
await c.query(
  `INSERT INTO recipe_ingredients (recipe_id, name, qty, unit, inventory_item_id, sort_order)
   VALUES ($1,'ZV13_Масло сливочное',0.5,'л',$2,1)`,
  [REC_C, INV_C]
);

// Товары: A/B/C с рецептами, D — без рецепта (RECIPE_MISSING)
async function mkProduct(slug, title, recipeId) {
  const r = await c.query(
    `INSERT INTO products (confectioner_id, slug, title, description, price, currency, status, recipe_id, production_time_hours, min_order_qty, is_available)
     VALUES ($1,$2,$3,'Z-v13 fixture',1000,'RUB','published',$4,2,1,true) RETURNING id::text`,
    [CONF0_USER, slug, title, recipeId]
  );
  return r.rows[0].id;
}
const P_A = await mkProduct("zv13-product-a", "ZV13_Торт A (выполним)", REC_A);
const P_B = await mkProduct("zv13-product-b", "ZV13_Торт B (нехватка)", REC_B);
const P_C = await mkProduct("zv13-product-c", "ZV13_Торт C (единицы)", REC_C);
const P_D = await mkProduct("zv13-product-d", "ZV13_Торт D (без рецепта)", null);

// Заказы: 5 шт PENDING, кондитер con0, покупатель demo, доставка +7 дней
async function mkOrder(num, productId, productTitle, qty) {
  const r = await c.query(
    `INSERT INTO orders (number, user_id, confectioner_id, subtotal, delivery_cost, discount, total, status, type,
                         delivery_type, delivery_city, delivery_address, delivery_date, delivery_time_window, payment_status)
     VALUES ($1::text,$2::uuid,$3::uuid,$6::int,0,0,$6::int,'PENDING',$4::text,$5::text,$7::text,'г. Москва, ул. Тестовая ZV13, д. 1',CURRENT_DATE+7,'10:00-18:00','pending')
     RETURNING id::text`,
    [num, CUSTOMER_USER, CONF0_USER, ORD_TYPE, ORD_DELIVERY_TYPE, 1000 * qty, ORD_CITY]
  );
  const orderId = r.rows[0].id;
  await c.query(
    `INSERT INTO order_items (order_id, product_id, product_title, title, unit_price, quantity, total)
     VALUES ($1::uuid,$2::uuid,$3::text,$3::text,1000,$4::int,1000*$4::int)`,
    [orderId, productId, productTitle, qty]
  );
  return orderId;
}
const O_A = await mkOrder("ZV13-A", P_A, "ZV13_Торт A (выполним)", 1);      // позитив: accept → CONFIRMED
const O_B = await mkOrder("ZV13-B", P_B, "ZV13_Торт B (нехватка)", 10);     // LOW_STOCK → 409
const O_C = await mkOrder("ZV13-C", P_C, "ZV13_Торт C (единицы)", 2);       // unit_mismatch → 409
const O_D = await mkOrder("ZV13-D", P_D, "ZV13_Торт D (без рецепта)", 1);   // RECIPE_MISSING → 409
const O_E = await mkOrder("ZV13-E", P_A, "ZV13_Торт A (параллель)", 1);     // параллельный accept
// Чужой заказ: назначен кондитеру c1 (не con0) — проверка 403 при accept от con0
const C1_USER = "11111111-1111-4111-8111-111111111102";
const oF = await c.query(
  `INSERT INTO orders (number, user_id, confectioner_id, subtotal, delivery_cost, discount, total, status, type,
                       delivery_type, delivery_city, delivery_address, delivery_date, delivery_time_window, payment_status)
   VALUES ('ZV13-F',$1::uuid,$2::uuid,1000,0,0,1000,'PENDING',$3::text,$4::text,$5::text,'г. Москва, ул. Чужая ZV13, д. 2',CURRENT_DATE+7,'10:00-18:00','pending')
   RETURNING id::text`,
  [CUSTOMER_USER, C1_USER, ORD_TYPE, ORD_DELIVERY_TYPE, ORD_CITY]
);
const O_F = oF.rows[0].id;
await c.query(
  `INSERT INTO order_items (order_id, product_id, product_title, title, unit_price, quantity, total)
   VALUES ($1::uuid,$2::uuid,$3::text,$3::text,1000,1,1000)`,
  [O_F, P_A, "ZV13_Торт F (у c1)"]
);
// Чужой заказ для покупателя: user_id = con0 (кондитер как покупатель), исполнитель c1
const oG = await c.query(
  `INSERT INTO orders (number, user_id, confectioner_id, subtotal, delivery_cost, discount, total, status, type,
                       delivery_type, delivery_city, delivery_address, delivery_date, delivery_time_window, payment_status)
   VALUES ('ZV13-G',$1::uuid,$2::uuid,1000,0,0,1000,'PENDING',$3::text,$4::text,$5::text,'г. Москва, ул. Чужая ZV13, д. 3',CURRENT_DATE+7,'10:00-18:00','pending')
   RETURNING id::text`,
  [CONF0_USER, C1_USER, ORD_TYPE, ORD_DELIVERY_TYPE, ORD_CITY]
);
const O_G = oG.rows[0].id;
await c.query(
  `INSERT INTO order_items (order_id, product_id, product_title, title, unit_price, quantity, total)
   VALUES ($1::uuid,$2::uuid,$3::text,$3::text,1000,1,1000)`,
  [O_G, P_A, "ZV13_Торт G (не покупателя)"]
);

const out = {
  INV_A, INV_B, INV_C, REC_A, REC_B, REC_C,
  P_A, P_B, P_C, P_D,
  O_A, O_B, O_C, O_D, O_E, O_F, O_G,
};
console.log(JSON.stringify(out, null, 1));
// Для E2E-скрипта
const { writeFileSync } = await import("node:fs");
writeFileSync("/tmp/zv13-ids.json", JSON.stringify(out));

await c.end();
