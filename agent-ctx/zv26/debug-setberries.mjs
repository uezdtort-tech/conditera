import pg from "pg";
process.env.DATABASE_URL = "postgresql://postgres@127.0.0.1:54329/conditera_zv26_gate";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const CONF = "11111111-1111-4111-8111-111111111101";
// как в сценарии D:
await pool.query(`UPDATE public.inventory_items SET quantity=$2 WHERE owner_id=$1::uuid AND (name='Ягоды' OR lower(trim(name))='ягоды')`, [CONF, 100]);
const chk = await pool.query(`SELECT name, quantity::text FROM public.inventory_items WHERE owner_id=$1::uuid AND (name='Ягоды' OR lower(trim(name))='ягоды')`, [CONF]);
console.log("AFTER UPDATE:", JSON.stringify(chk.rows));
const { computeIngredientNeeds } = await import("@/lib/ops/breakdown");
const rid = (await pool.query(`SELECT id::text FROM public.recipes WHERE title='Красный бархат (демо)' LIMIT 1`)).rows[0].id;
const needs = await computeIngredientNeeds([{ recipe_id: rid, quantity: 1 }], CONF);
console.log("shortages:", JSON.stringify(needs.shortages));
console.log("berries:", JSON.stringify(needs.ingredients.find(i=>i.name==='Ягоды')));
// восстановить
await pool.query(`UPDATE public.inventory_items SET quantity=1000 WHERE owner_id=$1::uuid AND name='Ягоды'`, [CONF]);
const ridIng = await pool.query(`SELECT recipe_id::text, name, qty::text, inventory_item_id::text FROM public.recipe_ingredients WHERE name='Ягоды'`);
console.log("RECIPE_ING Ягоды:", JSON.stringify(ridIng.rows));
await pool.end();
