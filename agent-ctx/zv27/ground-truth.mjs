import { Client } from 'pg';

process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:54329/conditera';
const url = process.env.DATABASE_URL;
if (!url) { console.error('NO DATABASE_URL'); process.exit(1); }
const masked = url.replace(/\/\/[^@]*@/, '//***@');
console.log('DB:', masked);
const c = new Client({ connectionString: url });
await c.connect();

const q = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log(`\n## ${label}`);
    if (r.rows.length === 0) console.log('(0 rows)');
    else for (const row of r.rows) console.log(JSON.stringify(row));
    return r;
  } catch (e) { console.log(`\n## ${label}\nERROR: ${e.message}`); return { rows: [] }; }
};

await q('products (published, not deleted)', `SELECT id, title, price, recipe_id, production_time_hours, is_available, confectioner_id FROM products WHERE status='published' AND deleted_at IS NULL ORDER BY id`);
await q('recipes', `SELECT id, name, is_active FROM recipes ORDER BY created_at`);
await q('recipe_ingredients of Красный бархат', `SELECT ri.name, ri.quantity, ri.unit, ri.inventory_item_id FROM recipe_ingredients ri WHERE ri.recipe_id = (SELECT id FROM recipes WHERE name LIKE '%Красный бархат%')`);
await q('inventory_items', `SELECT name, quantity, unit, is_active FROM inventory_items WHERE deleted_at IS NULL ORDER BY name`);
await q('purchases', `SELECT id, status, expected_eta FROM purchases ORDER BY created_at`);
await q('purchase_items', `SELECT name, quantity, unit FROM purchase_items`);
await q('confectioner_capacity count', `SELECT count(*) AS n FROM confectioner_capacity`);
await q('capacity_reservations count', `SELECT count(*) AS n FROM capacity_reservations`);
await q('inventory_movements count', `SELECT count(*) AS n FROM inventory_movements`);
await q('migration ledger tail', `SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 5`);
await q('duplicate migration IDs in ledger', `SELECT version, count(*) AS n FROM schema_migrations GROUP BY version HAVING count(*)>1`);
await q('orders count', `SELECT count(*) AS n FROM orders`);
await c.end();
console.log('\nDONE');
