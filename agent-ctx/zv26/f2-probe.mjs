// создать disposable-БД для теста F2 и подложить временную миграцию-ломатель
import { readFileSync } from "node:fs";
import pg from "pg";
import { mkdirSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
const env = readFileSync("/home/z/my-project/.env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
const admin = new pg.Pool({ connectionString: url.replace(/\/conditera$/, "/postgres"), max: 2 });
const name = "conditera_zv26_f2test";
try { await admin.query(`DROP DATABASE IF EXISTS ${name}`); } catch {}
await admin.query(`CREATE DATABASE ${name}`);
console.log(`created ${name}`);
await admin.end();
// временная копия migrations dir с ломателем
mkdirSync("/tmp/zv26-legacy-test/migrations", { recursive: true });
copyFileSync("/home/z/my-project/supabase/migrations/0001_init.sql", "/tmp/zv26-legacy-test/migrations/0001_init_schema.sql");
writeFileSync("/tmp/zv26-legacy-test/migrations/0090_zv26_breaker.sql",
  "CREATE TABLE IF NOT EXISTS public.zv26_breaker (id int);\nSELECT * FROM public.nonexistent_zv26;\n");
console.log("breaker file written");
