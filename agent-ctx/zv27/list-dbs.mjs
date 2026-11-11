import { Client } from 'pg';
const c = new Client({ connectionString: 'postgresql://postgres@127.0.0.1:54329/postgres' });
await c.connect();
const r = await c.query(`SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname`);
console.log(r.rows.map(x=>x.datname).join('\n'));
await c.end();
