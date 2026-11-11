import { readFileSync } from "node:fs";
import pg from "pg";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const admin = new pg.Pool({ connectionString: url.replace(/\/conditera$/, "/postgres"), max: 2 });
const name = "conditera_zv26_gate";
const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname=$1`, [name]);
if (exists.rowCount === 0) {
  await admin.query(`CREATE DATABASE ${name}`);
  console.log(`created ${name}`);
} else {
  console.log(`${name} already exists`);
}
const ver = await admin.query(`SELECT version()`);
console.log(ver.rows[0].version.slice(0, 60));
await admin.end();
