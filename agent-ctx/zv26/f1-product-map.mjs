/**
 * Z-v26 Этап 2-3: независимая карта готовности published-товаров (read-only).
 */
import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 2 });

const products = await pool.query(`
  SELECT p.id::text, p.title, p.status, p.is_available, p.price::text,
         p.recipe_id::text, p.production_time_hours, p.confectioner_id::text,
         r.prep_time_minutes, r.cook_time_minutes, r.status AS recipe_status,
         r.updated_at AS recipe_updated_at,
         c.slug AS category_slug
  FROM public.products p
  LEFT JOIN public.recipes r ON r.id = p.recipe_id
  LEFT JOIN public.product_categories c ON c.id = p.category_id
  WHERE p.status = 'published' AND p.deleted_at IS NULL
  ORDER BY p.title
`);
console.log(`=== PUBLISHED PRODUCTS: ${products.rows.length} ===`);
for (const p of products.rows) console.log(JSON.stringify(p));

const recipes = await pool.query(`
  SELECT r.id::text, r.title, r.status, r.prep_time_minutes, r.cook_time_minutes, r.servings,
         count(ri.id) AS ing_count
  FROM public.recipes r LEFT JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
  GROUP BY r.id ORDER BY r.title
`);
console.log(`=== RECIPES: ${recipes.rows.length} ===`);
for (const r of recipes.rows) console.log(JSON.stringify(r));

const inv = await pool.query(`
  SELECT id::text, owner_id::text, name, quantity::text, unit, cost_per_unit, is_active
  FROM public.inventory_items ORDER BY owner_id, name
`);
console.log(`=== INVENTORY: ${inv.rows.length} ===`);
for (const i of inv.rows) console.log(JSON.stringify(i));

const purchases = await pool.query(`
  SELECT d.id::text, d.owner_id::text, d.status, d.expected_eta::text, count(i.id) AS items,
         string_agg(i.name, ', ') AS item_names
  FROM public.purchase_drafts d LEFT JOIN public.purchase_draft_items i ON i.draft_id = d.id
  GROUP BY d.id ORDER BY d.created_at
`);
console.log(`=== PURCHASE_DRAFTS: ${purchases.rows.length} ===`);
for (const p of purchases.rows) console.log(JSON.stringify(p));

const conf = await pool.query(`
  SELECT c."userId"::text AS uid, c."businessName", c."verificationStatus",
         (SELECT count(*) FROM public.capacity_slots s WHERE s.confectioner_id = c."userId"::text) AS slots
  FROM public.confectioners c
`);
console.log(`=== CONFECTIONERS: ${conf.rows.length} ===`);
for (const c of conf.rows) console.log(JSON.stringify(c));

const ri = await pool.query(`
  SELECT ri.recipe_id::text, ri.name, ri.qty::text, ri.unit, ri.inventory_item_id::text
  FROM public.recipe_ingredients ri ORDER BY ri.recipe_id, ri.sort_order
`);
console.log(`=== RECIPE_INGREDIENTS: ${ri.rows.length} ===`);
for (const r of ri.rows) console.log(JSON.stringify(r));

const cap = await pool.query(`
  SELECT confectioner_id::text, date::text, capacity_minutes, is_day_off, count(*) OVER (PARTITION BY confectioner_id) AS total_rows
  FROM public.capacity_slots ORDER BY confectioner_id, date LIMIT 40
`);
console.log(`=== CAPACITY_SLOTS (first 40): ${cap.rows.length} ===`);
for (const c of cap.rows) console.log(JSON.stringify(c));

await pool.end();
