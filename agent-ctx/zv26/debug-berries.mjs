import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgresql://postgres@127.0.0.1:54329/conditera_zv26_gate", max: 2 });
const rows = await pool.query(`SELECT id::text, owner_id::text, name, quantity::text, unit, is_active, category FROM public.inventory_items WHERE name ILIKE '%ягод%' OR name ILIKE '%Ягод%'`);
console.log(`BERRY ROWS: ${rows.rows.length}`);
for (const r of rows.rows) console.log(JSON.stringify(r));
const rec = await pool.query(`SELECT recipe_id::text, name, qty::text, unit, inventory_item_id::text FROM public.recipe_ingredients WHERE name ILIKE '%яг%'`);
for (const r of rec.rows) console.log("RECIPE:", JSON.stringify(r));
// прямой вызов computeIngredientNeeds через реальный код
process.env.DATABASE_URL = "postgresql://postgres@127.0.0.1:54329/conditera_zv26_gate";
const { computeIngredientNeeds } = await import("@/lib/ops/breakdown");
const rid = (await pool.query(`SELECT id::text FROM public.recipes WHERE title='Красный бархат (демо)' LIMIT 1`)).rows[0].id;
const needs = await computeIngredientNeeds([{ recipe_id: rid, quantity: 1 }], "11111111-1111-4111-8111-111111111101");
console.log("NEEDS:", JSON.stringify(needs, null, 1));
await pool.end();
