import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres@127.0.0.1:54329/conditera_zv27_gate" });
// remove leftover zv27 test artifacts
await pool.query(`DELETE FROM public.inventory_write_offs WHERE order_id IN (SELECT id FROM public.orders WHERE number LIKE 'ZV27-%')`);
await pool.query(`DELETE FROM public.capacity_reservations WHERE order_id IN (SELECT id FROM public.orders WHERE number LIKE 'ZV27-%')`);
const d = await pool.query(`DELETE FROM public.orders WHERE number LIKE 'ZV27-%' RETURNING number`);
console.log('deleted orders:', d.rows.map(r=>r.number).join(', ') || 'none');
// restore stock/unit fixtures
await pool.query(`UPDATE public.inventory_items SET quantity=1000, unit='г' WHERE owner_id='11111111-1111-4111-8111-111111111101'::uuid AND name='Ягоды'`);
await pool.query(`UPDATE public.recipe_ingredients SET qty=250 WHERE name='Ягоды' AND recipe_id=(SELECT id FROM public.recipes WHERE title='Красный бархат (демо)')`);
console.log('fixtures restored');
await pool.end();
