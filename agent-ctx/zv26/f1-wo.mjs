import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 2 });
for (const t of ["inventory_write_offs", "stock_movements"]) {
  const c = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
  const n = await pool.query(`SELECT count(*) FROM public.${t}`);
  console.log(`${t}: ${n.rows[0].count} rows; cols: ${c.rows.map(x=>x.column_name).join(", ")}`);
}
const wo = await pool.query(`SELECT * FROM public.inventory_write_offs ORDER BY created_at DESC LIMIT 5`);
for (const r of wo.rows) console.log(JSON.stringify(r));
await pool.end();
