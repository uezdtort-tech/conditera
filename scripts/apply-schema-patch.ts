import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PGLITE_DB_PATH = join(process.cwd(), "db", "pglite-dev");
const SQL_FILE = join(process.cwd(), "prisma", "migrations", "0001_full_schema.sql");

async function main() {
  if (!existsSync(PGLITE_DB_PATH)) {
    mkdirSync(PGLITE_DB_PATH, { recursive: true });
  }

  console.log(`[apply] Opening PGlite at ${PGLITE_DB_PATH}`);
  const db = new PGlite(PGLITE_DB_PATH);

  const sql = readFileSync(SQL_FILE, "utf-8");

  // Разделяем на statements по точке с запятой
  const statements = sql
    .split(";\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 5 && !s.startsWith("--"));

  console.log(`[apply] ${statements.length} statements to execute`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ";";
    try {
      await db.exec(stmt);
      success++;
    } catch (e: any) {
      const msg = e.message || "";
      if (msg.includes("already exists") || msg.includes("does not exist")) {
        skipped++;
      } else {
        failed++;
        if (failed <= 5) {
          console.error(`[apply] Statement ${i + 1} failed: ${msg.slice(0, 120)}`);
        }
      }
    }
  }

  console.log(`[apply] Done: ${success} success, ${skipped} skipped, ${failed} failed`);

  // Проверка — считаем таблицы
  const result = await db.query(`
    SELECT count(*)::int as count FROM information_schema.tables WHERE table_schema = 'public'
  `);
  console.log(`[apply] Tables in DB: ${result.rows[0]?.count || 0}`);

  await db.close();
}

main().catch(console.error);
