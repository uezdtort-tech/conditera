import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const admin = new pg.Pool({ connectionString: url.replace(/\/conditera$/, "/postgres"), max: 2 });
for (const name of ["conditera_zv26_flock", "conditera_zv26_f2test"]) {
  try {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [name]);
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    console.log(`dropped ${name}`);
  } catch (e) { console.log(`${name}: ${e.message.slice(0,80)}`); }
}
const rest = await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 'conditera_zv26%'`);
console.log("remaining zv26 dbs:", rest.rows.map(r=>r.datname).join(", ") || "none");
await admin.end();
