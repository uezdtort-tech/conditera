import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 2 });
for (const t of ["orders", "order_items"]) {
  const c = await pool.query(`
    SELECT column_name, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND is_nullable='NO' AND column_default IS NULL ORDER BY ordinal_position`, [t]);
  console.log(`${t} NOT NULL no-default: ${c.rows.map(x=>x.column_name).join(", ")}`);
}
const demo = await pool.query(`SELECT id::text, number, status, payment_status, user_id::text, confectioner_id::text, delivery_date::text, delivery_time_window FROM public.orders ORDER BY created_at DESC LIMIT 3`);
for (const r of demo.rows) console.log(JSON.stringify(r));
await pool.end();
