import { join } from "node:path";
/**
 * PGlite migration runner.
 *
 * Prisma CLI can't talk to PGlite directly (no driver adapter for migrations).
 * This script:
 *   1. Reads SQL files from prisma/migrations/
 *   2. Executes them against the local PGlite database
 *   3. Records applied migrations in a _prisma_migrations table
 *
 * Usage:  bun run scripts/migrate-pglite.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PGLITE_DB_PATH =
  process.env.PGLITE_DB_PATH || join(process.cwd(), "db", "pglite-dev");
const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

async function main() {
  // Ensure parent dir exists
  const parentDir = PGLITE_DB_PATH;
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  console.log(`[migrate] Opening PGlite at ${PGLITE_DB_PATH}`);
  const db = new PGlite(PGLITE_DB_PATH);

  // Ensure migrations bookkeeping table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id            VARCHAR(36) PRIMARY KEY NOT NULL,
      checksum      VARCHAR(64) NOT NULL,
      finished_at   TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL,
      logs          TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  // List migration files
  if (!existsSync(MIGRATIONS_DIR)) {
    console.warn(`[migrate] No migrations directory at ${MIGRATIONS_DIR}`);
    await db.close();
    return;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`[migrate] Found ${files.length} migration file(s): ${files.join(", ") || "(none)"}`);

  for (const file of files) {
    const migrationName = file.replace(/\.sql$/, "");
    const filePath = join(MIGRATIONS_DIR, file);

    // Skip if already applied
    const already = await db.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE migration_name = $1`,
      [migrationName]
    );
    if (already.rows[0]?.count && already.rows[0].count > 0) {
      console.log(`[migrate] ✓ already applied: ${migrationName}`);
      continue;
    }

    // Insert started_at row
    const migrationId = crypto.randomUUID();
    await db.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1, $2, $3, now())`,
      [migrationId, "", migrationName]
    );

    console.log(`[migrate] → applying: ${migrationName}`);
    const sql = readFileSync(filePath, "utf-8");

    try {
      // PGlite executes one statement per query() call. Strip comment lines,
      // then split on `;` to get individual statements.
      const statements = sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(/;\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        try {
          await db.query(stmt);
        } catch (err) {
          // Ignore "already exists" errors so re-runs are safe
          const msg = (err as Error).message;
          if (/already exists|duplicate key/i.test(msg)) {
            continue;
          }
          throw err;
        }
      }

      await db.query(
        `UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = $2 WHERE id = $1`,
        [migrationId, statements.length]
      );
      console.log(`[migrate] ✓ applied: ${migrationName} (${statements.length} statements)`);
    } catch (err) {
      console.error(`[migrate] ✗ failed: ${migrationName}`);
      console.error(err);
      await db.query(
        `UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1`,
        [migrationId, (err as Error).message]
      );
      await db.close();
      process.exit(1);
    }
  }

  // Smoke test: list tables
  const tables = await db.query<{ table_name: string }[]>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log(
    `[migrate] ✓ database ready. Tables (${tables.rows.length}):`,
    tables.rows.map((r) => r.table_name).join(", ")
  );

  await db.close();
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
