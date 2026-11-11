import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 2 });
for (const t of ["products", "recipes", "recipe_items", "inventory_items", "purchase_drafts", "confectioners"]) {
  const cols = await pool.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
  console.log(`=== ${t} (${cols.rows.length} cols) ===`);
  console.log(cols.rows.map(c => `${c.column_name}:${c.data_type}`).join(", "));
}
await pool.end();
