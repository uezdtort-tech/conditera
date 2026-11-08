/** cleanup-v17-http.mjs — удаление незавершённых HTTP-тестовых данных Z-v17. */
import { Pool } from "pg";
import { readFileSync } from "node:fs";

const pool = new Pool({
  connectionString: (() => {
    const m = readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m);
    return m ? m[1].trim() : undefined;
  })(),
});

const users = await pool.query(
  "SELECT id FROM profiles WHERE email LIKE 'v17api-sup-%' OR email LIKE 'v17api-buy2-%'"
);
const ids = users.rows.map((r) => r.id);

if (ids.length > 0) {
  // 1a. Items напрямую по товарам тестовых поставщиков (покупатели могли быть удалены).
  await pool.query(
    `DELETE FROM purchase_order_items WHERE product_id IN (
       SELECT id FROM supplier_products WHERE supplier_id = ANY($1::uuid[]))`,
    [ids]
  );
  // 1b. Items всех заказов тестовых участников.
  await pool.query(
    `DELETE FROM purchase_order_items WHERE order_id IN (
       SELECT id FROM purchase_orders WHERE supplier_id = ANY($1::uuid[]) OR buyer_id = ANY($1::uuid[]))`,
    [ids]
  );
  await pool.query(
    `DELETE FROM purchase_order_status_history WHERE order_id IN (
       SELECT id FROM purchase_orders WHERE supplier_id = ANY($1::uuid[]) OR buyer_id = ANY($1::uuid[]))`,
    [ids]
  );
  await pool.query(
    `DELETE FROM purchase_orders WHERE supplier_id = ANY($1::uuid[]) OR buyer_id = ANY($1::uuid[])`,
    [ids]
  );
  await pool.query(
    `DELETE FROM supplier_product_movements WHERE supplier_id = ANY($1::uuid[])`,
    [ids]
  );
  await pool.query(`DELETE FROM supplier_products WHERE supplier_id = ANY($1::uuid[])`, [ids]);
  // 3. Профили поставщиков + журнал модерации.
  await pool.query(
    `DELETE FROM supplier_profile_reviews WHERE profile_id IN (
       SELECT id FROM supplier_profiles WHERE "userId" = ANY($1::text[]))`,
    [ids]
  );
  await pool.query(`DELETE FROM supplier_profiles WHERE "userId" = ANY($1::text[])`, [ids]);
  // 4. Уведомления, роли, профили, auth.
  await pool.query("DELETE FROM notifications WHERE user_id = ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM profiles WHERE id = ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [ids]);
}
console.log("cleanup done:", ids.length, "users removed");
await pool.end();
