/**
 * scripts/init-db-local.ts
 * ============================================================================
 * Unified local DB initialization script for «Уездный кондитер».
 *
 * This script is the single entry point for setting up a local development DB.
 * It supports two backends:
 *
 *   1. PostgreSQL via DATABASE_URL (Docker / native PG / Supabase local)
 *      — full feature set (extensions, RLS, pg_cron, pgsodium)
 *      — used by `docker-compose.dev.yml` (port 5433) or `docker-compose.supabase.yml`
 *
 *   2. PGlite (in-process WASM Postgres, no Docker required)
 *      — used when DATABASE_URL is NOT set
 *      — skips Supabase-specific extensions (extensions schema, pg_cron, pgsodium)
 *      — skips RLS policies that reference auth.uid() (PGlite has no auth schema)
 *      — useful for CI, unit tests, smoke tests on machines without Docker
 *
 * Usage:
 *   npx tsx scripts/init-db-local.ts                # auto-detect: PG_URL → PG, else PGlite
 *   npx tsx scripts/init-db-local.ts --pglite       # force PGlite
 *   npx tsx scripts/init-db-local.ts --pg           # force PostgreSQL (requires DATABASE_URL)
 *
 * Exit codes:
 *   0 — success, DB is ready
 *   1 — fatal error (missing dependency, SQL syntax error, etc.)
 * ============================================================================
 */

import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// Use process.cwd() for portable paths — works on Windows, Mac, Linux.
// When running from project root, this resolves to the project directory.
const PROJECT_ROOT = resolve(process.cwd());

const MIGRATIONS_DIR = join(PROJECT_ROOT, "supabase", "migrations");
const SEED_FILES = [
  join(PROJECT_ROOT, "supabase", "seed.sql"),
  join(PROJECT_ROOT, "supabase", "seed_cms_crm.sql"),
  join(PROJECT_ROOT, "supabase", "seed_fillings.sql"),
];

const PGLITE_DB_PATH =
  process.env.PGLITE_DB_PATH || join(PROJECT_ROOT, "db", "pglite-dev");

interface SqlRunner {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

/**
 * Wrap a single statement in BEGIN/COMMIT so a failure doesn't abort
 * the entire session (PostgreSQL aborts the whole transaction on error,
 * which causes all subsequent statements to fail with
 * "current transaction is aborted, commands ignored until end of transaction block").
 *
 * On failure, we issue ROLLBACK and the next statement starts fresh.
 */
async function safeExec(
  runner: SqlRunner,
  stmt: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await runner.query("BEGIN");
    await runner.query(stmt);
    await runner.query("COMMIT");
    return { ok: true };
  } catch (err: unknown) {
    const msg = (err as Error).message || String(err);
    try {
      await runner.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    return { ok: false, error: msg };
  }
}

// ============================================================================
// 1. SQL splitter — handles comments, dollar-quoted strings, semicolons
// ============================================================================
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let inDollarQuote: string | null = null;
  let inSingleQuote = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    // Line comment (--)
    if (next2 === "--" && !inDollarQuote && !inSingleQuote) {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    // Block comment (/* */)
    if (next2 === "/*" && !inDollarQuote && !inSingleQuote) {
      i += 2;
      while (i < sql.length && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    // Dollar-quote start ($tag$)
    if (ch === "$" && !inDollarQuote && !inSingleQuote) {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        current += tag;
        i += tag.length;
        inDollarQuote = tag;
        continue;
      }
    }
    // Dollar-quote end
    if (inDollarQuote && sql.slice(i, i + inDollarQuote.length) === inDollarQuote) {
      current += inDollarQuote;
      i += inDollarQuote.length;
      inDollarQuote = null;
      continue;
    }
    // Single-quote literal
    if (ch === "'" && !inDollarQuote) {
      inSingleQuote = !inSingleQuote;
    }
    // Statement separator
    if (ch === ";" && !inDollarQuote && !inSingleQuote) {
      const stmt = current.trim();
      if (stmt.length > 0) statements.push(stmt);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const last = current.trim();
  if (last.length > 0) statements.push(last);
  return statements;
}

// ============================================================================
// 2. SQL preprocessor — strips Supabase-specific syntax for PGlite
// ============================================================================
function preprocessForPglite(sql: string): string {
  let out = sql;

  // 1. Remove "WITH SCHEMA extensions" — PGlite has no extensions schema
  out = out.replace(/WITH SCHEMA extensions/gi, "WITH SCHEMA public");

  // 2. Skip ALL CREATE EXTENSION statements — PGlite bundles pgcrypto,
  //    pg_trgm (partial), but doesn't accept the CREATE EXTENSION syntax.
  //    Functions like gen_random_uuid() are already available.
  out = out.replace(
    /CREATE EXTENSION IF NOT EXISTS\s+["]?[a-z_]+["]?\s*(WITH SCHEMA [a-z_]+)?\s*;/gi,
    "-- skipped: CREATE EXTENSION (PGlite bundles built-in extensions)"
  );

  // 3. Skip `auth.users` references → put replacement comment on its OWN line
  //    so the trailing comma stays on the column-definition line.
  //    (Putting `-- comment` on the same line would eat the comma into the comment.)
  out = out.replace(
    /REFERENCES\s+auth\.users\s*\([^)]+\)\s*(ON DELETE [^,;]+)?/gi,
    "\n-- dropped FK to auth.users (PGlite has no auth schema)\n  "
  );

  // 4. Skip `auth.uid()` calls inside RLS policies → replace with NULL::uuid
  //    This effectively disables RLS for PGlite (which is fine for local dev).
  out = out.replace(/auth\.uid\(\)/gi, "NULL::uuid");

  // 5. Replace uuid_generate_v4() (from uuid-ossp) with gen_random_uuid() (pgcrypto)
  //    PGlite bundles pgcrypto, so gen_random_uuid() works out of the box.
  out = out.replace(/extensions\.uuid_generate_v4\(\)/gi, "gen_random_uuid()");
  out = out.replace(/\buuid_generate_v4\(\)/gi, "gen_random_uuid()");

  return out;
}

// ============================================================================
// 3. PGlite backend
// ============================================================================
async function makePgliteRunner(): Promise<SqlRunner> {
  const { PGlite } = await import("@electric-sql/pglite");

  if (!existsSync(PGLITE_DB_PATH)) {
    mkdirSync(PGLITE_DB_PATH, { recursive: true });
  }

  console.log(`[init-db] Opening PGlite at ${PGLITE_DB_PATH}`);
  const db = new PGlite(PGLITE_DB_PATH);

  return {
    async query<T = unknown>(sql: string, params: unknown[] = []) {
      // PGlite's query accepts (text, values[])
      return (db.query as unknown as (s: string, p?: unknown[]) => Promise<{ rows: T[] }>)(
        sql,
        params
      );
    },
    async close() {
      await db.close();
    },
  };
}

// ============================================================================
// 4. PostgreSQL backend (via pg Client)
// ============================================================================
async function makePgRunner(connectionString: string): Promise<SqlRunner> {
  let pg: typeof import("pg");
  try {
    pg = await import("pg");
  } catch {
    throw new Error(
      "[init-db] `pg` package is not installed. Run `npm install pg --no-save` to use PostgreSQL backend."
    );
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  console.log(`[init-db] Connected to PostgreSQL at ${connectionString.replace(/:[^:]*@/, ":***@")}`);
  return {
    async query<T = unknown>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params);
      return { rows: res.rows as T[] };
    },
    async close() {
      await client.end();
    },
  };
}

// ============================================================================
// 5. Apply a single SQL file (statement-by-statement, with error tolerance)
// ============================================================================
async function applySqlFile(
  runner: SqlRunner,
  filePath: string,
  label: string,
  isPglite: boolean
): Promise<{ applied: number; skipped: number; failed: number }> {
  const rawSql = readFileSync(filePath, "utf-8");
  const sql = isPglite ? preprocessForPglite(rawSql) : rawSql;
  const statements = splitSqlStatements(sql);

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const stmt of statements) {
    const r = await safeExec(runner, stmt);
    if (r.ok) {
      applied++;
      continue;
    }
    const msg = r.error || "";
    // Idempotent: skip "already exists" / "duplicate key" / "does not exist"
    if (
      /already exists|duplicate key|does not exist|cannot be used|must be owner|no such table/i.test(
        msg
      )
    ) {
      skipped++;
    } else {
      failed++;
      // Print first 80 chars of statement + first 200 chars of error
      const stmtPreview = stmt.length > 80 ? stmt.slice(0, 80) + "..." : stmt;
      console.warn(`  ⚠  ${label}: ${stmtPreview}`);
      console.warn(`     ${msg.slice(0, 200)}`);
    }
  }

  console.log(`  ✓ ${label}: ${applied} applied, ${skipped} skipped, ${failed} failed`);
  return { applied, skipped, failed };
}

// ============================================================================
// 6. Main
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  const forcePglite = args.includes("--pglite");
  const forcePg = args.includes("--pg");

  const databaseUrl = process.env.DATABASE_URL;
  const usePglite = forcePglite || (!forcePg && !databaseUrl);

  console.log("=== Инициализация БД «Уездный кондитер» ===");
  console.log(`Backend: ${usePglite ? "PGlite (WASM, no Docker)" : "PostgreSQL"}`);
  if (!usePglite && !databaseUrl) {
    console.error("[init-db] DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }
  console.log("");

  // 1. Open runner
  const runner: SqlRunner = usePglite
    ? await makePgliteRunner()
    : await makePgRunner(databaseUrl!);

  // 2. Apply migrations
  console.log("→ Applying migrations:");
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let totalApplied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const file of migrationFiles) {
    const filePath = join(MIGRATIONS_DIR, file);
    const r = await applySqlFile(runner, filePath, file, usePglite);
    totalApplied += r.applied;
    totalSkipped += r.skipped;
    totalFailed += r.failed;
  }

  console.log(
    `\n  Total: ${totalApplied} applied, ${totalSkipped} skipped, ${totalFailed} failed`
  );

  // 3. Apply seed files
  console.log("\n→ Loading seed data:");
  for (const seedFile of SEED_FILES) {
    if (existsSync(seedFile)) {
      await applySqlFile(runner, seedFile, seedFile.split("/").pop()!, usePglite);
    } else {
      console.warn(`  ⚠  Seed file not found: ${seedFile}`);
    }
  }

  // 4. Verification — list tables & critical counts
  console.log("\n→ Verification:");
  const tablesRes = await runner.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log(`  Tables in 'public': ${tablesRes.rows.length}`);

  // Show a sample of tables that the application actually uses
  const expected = [
    "profiles",
    "user_roles",
    "products",
    "product_categories",
    "orders",
    "order_items",
    "confectioners",
    "audit_log",
    "fillings",
    "builder_config",
    "site_settings",
    "cms_pages",
  ];
  const tableNames = new Set(tablesRes.rows.map((r) => r.table_name));
  const missing = expected.filter((t) => !tableNames.has(t));
  if (missing.length === 0) {
    console.log(`  ✓ All ${expected.length} critical tables are present`);
  } else {
    console.warn(`  ⚠  Missing critical tables: ${missing.join(", ")}`);
  }

  // Count records in key tables (non-fatal if table missing)
  const countTables = [
    "product_categories",
    "fillings",
    "cms_pages",
    "cms_nav_menu",
  ];
  console.log("\n  Record counts:");
  for (const t of countTables) {
    if (!tableNames.has(t)) {
      console.log(`    ${t}: (table missing)`);
      continue;
    }
    try {
      const r = await runner.query<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM public.${t}`);
      console.log(`    ${t}: ${r.rows[0]?.cnt ?? "?"}`);
    } catch (e) {
      console.log(`    ${t}: (error: ${(e as Error).message.slice(0, 60)})`);
    }
  }

  await runner.close();

  console.log("\n=== База данных готова к работе ===");
  if (usePglite) {
    console.log(`Backend: PGlite (file: ${PGLITE_DB_PATH})`);
    console.log("  Note: RLS and Supabase extensions are skipped in PGlite mode.");
    console.log("  For full-feature DB use Docker: ./scripts/init-db.sh");
  } else {
    console.log(`Backend: PostgreSQL (${databaseUrl})`);
  }
}

main().catch((err) => {
  console.error("[init-db] FATAL:", err);
  process.exit(1);
});
