import { Client } from 'pg';
const c = new Client({ connectionString: 'postgresql://postgres@127.0.0.1:54329/conditera' });
await c.connect();
const r = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
console.log(r.rows.map(x=>x.table_name).join('\n'));
await c.end();
