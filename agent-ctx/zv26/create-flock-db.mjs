import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const admin = new pg.Pool({ connectionString: url.replace(/\/conditera$/, "/postgres"), max: 2 });
const name = "conditera_zv26_flock";
const ex = await admin.query(`SELECT 1 FROM pg_database WHERE datname=$1`, [name]);
if (ex.rowCount === 0) { await admin.query(`CREATE DATABASE ${name}`); console.log(`created ${name}`); }
else {
  // очистить существующую (disposable, наша) — пересоздание для чистоты теста
  await admin.end();
  const kill = new pg.Pool({ connectionString: url.replace(/\/conditera$/, "/postgres"), max: 2 });
  await kill.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [name]);
  await kill.query(`DROP DATABASE ${name}`);
  await kill.query(`CREATE DATABASE ${name}`);
  console.log(`recreated ${name}`);
  await kill.end();
  process.exit(0);
}
await admin.end();
