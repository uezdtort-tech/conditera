import { Client } from 'pg';
const c = new Client({ connectionString: 'postgresql://postgres@127.0.0.1:54329/conditera' });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log(label + ': ' + JSON.stringify(r.rows)); }
  catch (e) { console.log(label + ' ERROR: ' + e.message); }
};
await q('recipe_versions count', 'SELECT count(*)::int AS n FROM recipe_versions');
await q('recipes by status', 'SELECT status, count(*)::int FROM recipes GROUP BY status');
await q('published products recipe', "SELECT count(*) FILTER (WHERE recipe_id IS NULL)::int AS no_recipe, count(*)::int AS total FROM products WHERE is_published=true");
await q('card_versions count', 'SELECT count(*)::int AS n FROM recipe_production_card_versions');
await q('orders metadata', 'SELECT count(*)::int AS total, count(metadata)::int AS with_metadata FROM orders');
await q('order_items columns', "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) AS cols FROM information_schema.columns WHERE table_name='order_items'");
await c.end();
