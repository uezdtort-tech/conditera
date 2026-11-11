import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 2 });
const fk = await pool.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'public.capacity_reservations'::regclass AND contype IN ('f','u','x')`);
for (const r of fk.rows) console.log(`${r.conname}: ${r.def}`);
await pool.end();
