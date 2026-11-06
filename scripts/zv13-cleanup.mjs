/**
 * Z-v13: адресная очистка изолированных тестовых фикстур (только ZV13-*).
 * Удаляет ровно те строки, которые создал scripts/zv13-fixtures.mjs:
 * order_items, orders, notifications (по orderId фикстур), order_status_history,
 * products, recipe_ingredients, recipes, inventory_items.
 * Существующие пользовательские данные не затрагиваются.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();

const c = new Client({ connectionString: url });
await c.connect();

// Идентификаторы текущих ZV13-заказов (по номеру — они уникальны за сессию)
const orders = await c.query(`SELECT id::text FROM orders WHERE number LIKE 'ZV13-%'`);
const ids = orders.rows.map((r) => r.id);

let deleted = {};
if (ids.length > 0) {
  const notif = await c.query(
    `DELETE FROM notifications WHERE metadata->>'orderId' = ANY($1::text[]) RETURNING id`,
    [ids]
  );
  const hist = await c.query(
    `DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[]) RETURNING id`,
    [ids]
  );
  const items = await c.query(
    `DELETE FROM order_items WHERE order_id = ANY($1::uuid[]) RETURNING id`,
    [ids]
  );
  deleted.notifications = notif.rowCount;
  deleted.history = hist.rowCount;
  deleted.order_items = items.rowCount;
}
const o = await c.query(`DELETE FROM orders WHERE number LIKE 'ZV13-%' RETURNING number`);
const inv = await c.query(`DELETE FROM inventory_items WHERE name LIKE 'ZV13_%' RETURNING id`);
const ing = await c.query(
  `DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT id FROM recipes WHERE slug LIKE 'zv13-recipe-%') RETURNING id`
);
const rec = await c.query(`DELETE FROM recipes WHERE slug LIKE 'zv13-recipe-%' RETURNING id`);
const prod = await c.query(`DELETE FROM products WHERE slug LIKE 'zv13-product-%' RETURNING id`);

deleted.orders = o.rowCount;
deleted.inventory_items = inv.rowCount;
deleted.recipe_ingredients = ing.rowCount;
deleted.recipes = rec.rowCount;
deleted.products = prod.rowCount;

// Осиротевшие ZV13-уведомления (заказы уже удалены в прошлых прогонах)
const orphan = await c.query(
  `DELETE FROM notifications WHERE type='ORDER_CONFIRMED' AND title LIKE '%ZV13%' AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.id::text = notifications.metadata->>'orderId') RETURNING id`
);
deleted.orphan_notifications = orphan.rowCount;

console.log("ZV13 cleanup:", JSON.stringify(deleted));
await c.end();
