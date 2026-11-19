#!/usr/bin/env node
/**
 * Strict PostgreSQL 17 compatibility test for Conditera's SQL migrations.
 *
 * This test deliberately uses the local compatibility layer to provide the
 * auth/storage contracts required by the migration set. It does NOT represent
 * a production Supabase bootstrap and must never be used against production.
 *
 * Required: DATABASE_URL pointing to a disposable, empty PostgreSQL 17 database.
 */
import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const migrationsDir = join(root, "supabase", "migrations");
const compatFile = join(root, "supabase", "compat", "0000_supabase_compat.sql");
const databaseUrl = process.env.DATABASE_URL;
const expectedMajor = Number(process.env.EXPECTED_POSTGRES_MAJOR || 17);
const skipUnavailableExtensions = process.env.SKIP_UNAVAILABLE_EXTENSIONS === "1";

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  let inDollarQuote = null;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    if (next2 === "--" && !inDollarQuote && !inSingleQuote && !inDoubleQuote) {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (next2 === "/*" && !inDollarQuote && !inSingleQuote && !inDoubleQuote) {
      i += 2;
      while (i < sql.length && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    if (ch === "$" && !inDollarQuote && !inSingleQuote && !inDoubleQuote) {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        current += match[0];
        i += match[0].length;
        inDollarQuote = match[0];
        continue;
      }
    }
    if (inDollarQuote && sql.slice(i, i + inDollarQuote.length) === inDollarQuote) {
      current += inDollarQuote;
      i += inDollarQuote.length;
      inDollarQuote = null;
      continue;
    }
    if (ch === "'" && !inDollarQuote && !inDoubleQuote) {
      if (inSingleQuote && sql[i + 1] === "'") {
        current += "''";
        i += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inDollarQuote && !inSingleQuote) {
      if (inDoubleQuote && sql[i + 1] === '"') {
        current += '""';
        i += 2;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      i++;
      continue;
    }
    if (ch === ";" && !inDollarQuote && !inSingleQuote && !inDoubleQuote) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function naturalMigrationSort(a, b) {
  const pa = a.match(/^(\d+)(.*)$/);
  const pb = b.match(/^(\d+)(.*)$/);
  const na = pa ? Number(pa[1]) : Number.MAX_SAFE_INTEGER;
  const nb = pb ? Number(pb[1]) : Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;
  const sa = pa && pa[2] ? 1 : 0;
  const sb = pb && pb[2] ? 1 : 0;
  if (sa !== sb) return sa - sb;
  return a.localeCompare(b);
}

const client = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10000,
  statement_timeout: 120000,
});

try {
  await client.connect();

  const versionResult = await client.query(
    "SELECT current_setting('server_version_num')::int AS version_num, version() AS version"
  );
  const versionNum = versionResult.rows[0].version_num;
  const major = Math.floor(versionNum / 10000);
  if (major !== expectedMajor) {
    throw new Error(`Expected PostgreSQL ${expectedMajor}, received major ${major}: ${versionResult.rows[0].version}`);
  }
  console.log(`PostgreSQL ${expectedMajor} source verified: ${versionResult.rows[0].version}`);

  console.log("Applying isolated auth/storage compatibility fixture...");
  await client.query(readFileSync(compatFile, "utf8"));
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const availableResult = await client.query("SELECT name FROM pg_available_extensions");
  const availableExtensions = new Set(availableResult.rows.map((row) => row.name));

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort(naturalMigrationSort);

  console.log(`Applying ${files.length} SQL migrations...`);
  for (const file of files) {
    try {
      // Run one statement at a time, like psql -f. In particular, ALTER TYPE
      // ADD VALUE must commit before a later statement can use the new enum label.
      const statements = splitSqlStatements(readFileSync(join(migrationsDir, file), "utf8"));
      for (const statement of statements) {
        const extensionMatch = statement.match(/^CREATE\\s+EXTENSION\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"([^"]+)"|([a-zA-Z0-9_-]+))/i);
        const extensionName = extensionMatch?.[1] || extensionMatch?.[2];
        if (extensionName && !availableExtensions.has(extensionName) && skipUnavailableExtensions) {
          console.log(`  SKIP extension ${extensionName}: not packaged in this PostgreSQL distribution`);
          continue;
        }
        await client.query(statement);
      }
      await client.query("INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING", [file]);
      console.log(`  PASS ${file} (${statements.length} statements)`);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    }
  }

  const requiredExtensions = ["btree_gist", "pg_trgm", "pgcrypto", "uuid-ossp"];
  const extensionResult = await client.query(
    "SELECT extname FROM pg_extension WHERE extname = ANY($1::text[])",
    [requiredExtensions]
  );
  const installedExtensions = new Set(extensionResult.rows.map((row) => row.extname));
  const missingExtensions = requiredExtensions.filter((name) => !installedExtensions.has(name));
  if (missingExtensions.length) {
    throw new Error(`Required extensions not installed: ${missingExtensions.join(", ")}`);
  }

  const requiredTables = [
    "profiles", "user_roles", "products", "product_categories", "orders",
    "order_items", "confectioners", "audit_log", "fillings",
    "builder_config", "site_settings", "cms_pages", "confectioner_transactions",
  ];
  const tableResult = await client.query(
    "SELECT name FROM unnest($1::text[]) AS required(name) WHERE to_regclass('public.' || name) IS NOT NULL",
    [requiredTables]
  );
  const presentTables = new Set(tableResult.rows.map((row) => row.name));
  const missingTables = requiredTables.filter((name) => !presentTables.has(name));
  if (missingTables.length) {
    throw new Error(`Required Conditera tables missing: ${missingTables.join(", ")}`);
  }

  const policyResult = await client.query(
    "SELECT count(*)::int AS count FROM pg_policies WHERE schemaname = 'public'"
  );
  const rlsResult = await client.query(
    "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public' AND rowsecurity"
  );

  console.log("");
  console.log(`POSTGRESQL ${expectedMajor} MIGRATION CHECK PASSED`);
  console.log(`Migrations: ${files.length}`);
  console.log(`Required extensions: ${requiredExtensions.join(", ")}`);
  console.log(`Critical tables: ${requiredTables.length}`);
  console.log(`Public RLS policies: ${policyResult.rows[0].count}`);
  console.log(`Public tables with RLS enabled: ${rlsResult.rows[0].count}`);
} catch (error) {
  console.error(`\nPOSTGRESQL ${expectedMajor} MIGRATION CHECK FAILED`);
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
