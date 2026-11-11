// Одноразовая чистка остатков zv26-http-* (артефакты прерванного cleanup)
import pg from "pg";
import { readFileSync } from "node:fs";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const dbc = new pg.Client({ connectionString: url });
await dbc.connect();
const users = (await dbc.query(`SELECT id::text FROM public.profiles WHERE email LIKE 'zv26-http-%'`)).rows.map(r=>r.id);
console.log(`zv26-http users: ${users.length}`);
for (const uid of users) {
  const orders = (await dbc.query(`SELECT id::text FROM public.orders WHERE user_id=$1::uuid`, [uid])).rows.map(r=>r.id);
  for (const oid of orders) {
    await dbc.query(`DELETE FROM public.financial_ledger WHERE payment_id IN (SELECT id FROM public.payments WHERE order_id=$1::uuid)`, [oid]);
    await dbc.query(`DELETE FROM public.payments WHERE order_id=$1::uuid`, [oid]);
    await dbc.query(`DELETE FROM public.order_status_history WHERE order_id=$1::uuid`, [oid]);
    await dbc.query(`DELETE FROM public.order_items WHERE order_id=$1::uuid`, [oid]);
    await dbc.query(`DELETE FROM public.capacity_reservations WHERE order_id=$1::uuid`, [oid]);
    await dbc.query(`DELETE FROM public.orders WHERE id=$1::uuid`, [oid]);
  }
  await dbc.query(`DELETE FROM public.cart_items WHERE user_id=$1::uuid`, [uid]);
  await dbc.query(`DELETE FROM public.sessions WHERE "userId"=$1`, [uid]);
  await dbc.query(`DELETE FROM public.notifications WHERE user_id=$1::uuid`, [uid]);
  await dbc.query(`DELETE FROM public.profiles WHERE id=$1::uuid`, [uid]);
}
const chk = await dbc.query(`SELECT count(*)::int AS n FROM public.profiles WHERE email LIKE 'zv26-http-%'`);
console.log(`left: ${chk.rows[0].n}`);
await dbc.end();
