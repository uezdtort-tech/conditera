// Read-only DB query helper for cart verification (QA only, no writes)
const { Client } = require('/home/z/my-project/node_modules/pg');
async function main() {
  const q = process.argv[2];
  if (!q) { console.error('usage: node dbq.mjs "SELECT ..."'); process.exit(1); }
  if (!/^\s*(select|table)/i.test(q)) { console.error('refusing non-select query'); process.exit(2); }
  const c = new Client({ connectionString: 'postgresql://postgres@127.0.0.1:54329/conditera' });
  await c.connect();
  try {
    const r = await c.query(q);
    console.log(JSON.stringify(r.rows, null, 2));
  } finally { await c.end(); }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
