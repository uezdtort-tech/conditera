import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 2 });

// ингредиенты рецепта «Красный бархат»
const ri = await pool.query(`
  SELECT ri.recipe_id::text, r.title, ri.name, ri.qty::text, ri.unit, ri.inventory_item_id::text
  FROM public.recipe_ingredients ri JOIN public.recipes r ON r.id = ri.recipe_id
  ORDER BY r.title, ri.sort_order
`);
console.log(`=== RECIPE_INGREDIENTS: ${ri.rows.length} ===`);
for (const r of ri.rows) console.log(JSON.stringify(r));

// поиск таблиц capacity
const tables = await pool.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND (table_name LIKE '%capacity%' OR table_name LIKE '%slot%' OR table_name LIKE '%calendar%')
`);
console.log(`=== CAPACITY-LIKE TABLES: ${tables.rows.length} ===`);
for (const t of tables.rows) console.log(t.table_name);
await pool.end();
