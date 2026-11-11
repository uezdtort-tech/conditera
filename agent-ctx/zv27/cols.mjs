import { Client } from 'pg';
const c = new Client({ connectionString: 'postgresql://postgres@127.0.0.1:54329/conditera' });
await c.connect();
const tables = process.argv.slice(2);
for (const t of tables) {
  const r = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
  console.log(`\n## ${t}: ${r.rows.map(x=>x.column_name+':'+x.data_type.replace('character varying','varchar').replace('timestamp with time zone','timestamptz')).join(', ')}`);
}
await c.end();
