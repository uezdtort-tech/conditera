import { Client } from 'pg';
const c = new Client({ connectionString: 'postgresql://postgres@127.0.0.1:54329/conditera' });
await c.connect();
const q = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log(`\n## ${label}`);
    if (!r.rows.length) console.log('(0 rows)');
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) { console.log(`\n## ${label}\nERROR: ${e.message}`); }
};
await q('recipes (all)', `SELECT id, title, status, created_at::date FROM recipes ORDER BY created_at`);
await q('recipe_ingredients of Красный бархат', `SELECT name, qty, unit, inventory_item_id FROM recipe_ingredients WHERE recipe_id=(SELECT id FROM recipes WHERE title LIKE '%Красный бархат%')`);
await q('inventory_items (all)', `SELECT owner_id, name, quantity, unit, is_active FROM inventory_items ORDER BY name`);
await q('purchase_drafts', `SELECT id, status, expected_eta, created_at::date FROM purchase_drafts ORDER BY created_at`);
await q('purchase_draft_items', `SELECT name, quantity, unit FROM purchase_draft_items`);
await q('schema_migrations tail', `SELECT filename FROM schema_migrations ORDER BY applied_at DESC LIMIT 6`);
await q('migration ledger duplicates', `SELECT filename, count(*) FROM schema_migrations GROUP BY filename HAVING count(*)>1`);
await q('migration files on disk count', `SELECT count(DISTINCT filename) AS n FROM schema_migrations`);
await q('recipe_versions rows', `SELECT count(*) AS n FROM recipe_versions`);
await q('inventory_write_offs count', `SELECT count(*) AS n FROM inventory_write_offs`);
await c.end();
console.log('\nDONE');
