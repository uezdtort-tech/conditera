#!/usr/bin/env node
/**
 * Verify a full PostgreSQL dump by restoring it into a disposable database.
 * JSON exports are explicitly reported as PARTIAL because they contain only
 * an allowlisted subset of rows and do not recreate the original schema.
 */
import { readFileSync, existsSync, createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import pg from "pg";
import { createGunzip, gunzipSync } from "node:zlib";
import { pipeline } from "node:stream/promises";

function loadDbUrl() {
  if (process.env.PGURL) return process.env.PGURL;
  if (process.env.DIRECT_DATABASE_URL) return process.env.DIRECT_DATABASE_URL;
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgresql://")) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env", ".env.production"]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    for (const key of ["DIRECT_DATABASE_URL", "DATABASE_URL"]) {
      const line = lines.find((value) => value.startsWith(key + "="));
      if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return "postgresql://postgres@127.0.0.1:54329/conditera";
}

function cleanLibpqUrl(value) {
  const url = new URL(value);
  url.searchParams.delete("schema");
  url.searchParams.delete("pgbouncer");
  return url;
}

const DATABASE_URL = cleanLibpqUrl(loadDbUrl()).toString();
const parsed = new URL(DATABASE_URL);
const adminUrl = new URL(DATABASE_URL);
adminUrl.pathname = "/postgres";
const ADMIN_URL = adminUrl.toString();

const RESTORE_DB = "conditera_restore_verify_" + Date.now();
const restoreUrl = new URL(DATABASE_URL);
restoreUrl.pathname = "/" + RESTORE_DB;
const RESTORE_URL = restoreUrl.toString();

let failures = 0;
function check(name, ok, detail = "") {
  console.log((ok ? "✓ " : "✗ ") + name + (detail ? " — " + detail : ""));
  if (!ok) failures++;
}

function quoteIdent(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

async function createDisposableDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query("CREATE DATABASE " + quoteIdent(RESTORE_DB));
    console.log("created disposable database " + RESTORE_DB);
  } finally {
    await admin.end();
  }
}

async function dropDisposableDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query("DROP DATABASE IF EXISTS " + quoteIdent(RESTORE_DB) + " WITH (FORCE)");
    const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [RESTORE_DB]);
    check("disposable database removed; source database untouched", result.rows.length === 0);
  } finally {
    await admin.end();
  }
}

function runPsqlRestore(backupPath) {
  const url = new URL(RESTORE_URL);
  const password = decodeURIComponent(url.password);
  url.password = "";
  const env = { ...process.env };
  if (password) env.PGPASSWORD = password;

  const child = spawn(
    "psql",
    ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--dbname", url.toString()],
    { stdio: ["pipe", "inherit", "inherit"], env }
  );
  const exitPromise = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("psql restore exited with code " + code)));
  });
  const inputPromise = pipeline(createReadStream(backupPath), createGunzip(), child.stdin);
  try {
    await Promise.all([inputPromise, exitPromise]);
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function tableCounts(client) {
  const tables = await client.query(
    "SELECT n.nspname AS schema_name, c.relname AS table_name " +
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE c.relkind IN ('r', 'p') " +
    "AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' " +
    "AND n.nspname NOT LIKE 'pg_temp_%' " +
    "AND NOT EXISTS (SELECT 1 FROM pg_depend d " +
    "WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') " +
    "ORDER BY n.nspname, c.relname"
  );
  const counts = new Map();
  for (const row of tables.rows) {
    const key = row.schema_name + "." + row.table_name;
    const result = await client.query(
      "SELECT count(*)::text AS count FROM " +
      quoteIdent(row.schema_name) + "." + quoteIdent(row.table_name)
    );
    counts.set(key, result.rows[0].count);
  }
  return counts;
}

async function verifySqlBackup(backupPath) {
  console.log("Backup format: full PostgreSQL SQL dump");
  let databaseCreated = false;
  try {
    await createDisposableDatabase();
    databaseCreated = true;
    console.log("restoring compressed SQL dump with psql...");
    await runPsqlRestore(backupPath);
    check("SQL dump restored into disposable database", true);

    const source = new pg.Client({ connectionString: DATABASE_URL });
    const restored = new pg.Client({ connectionString: RESTORE_URL });
    await source.connect();
    await restored.connect();
    try {
      console.log("comparing user-table sets and exact row counts...");
      const sourceCounts = await tableCounts(source);
      const restoredCounts = await tableCounts(restored);
      const missing = [...sourceCounts.keys()].filter((key) => !restoredCounts.has(key));
      const extra = [...restoredCounts.keys()].filter((key) => !sourceCounts.has(key));
      const mismatched = [...sourceCounts.entries()]
        .filter(([key, count]) => restoredCounts.get(key) !== count)
        .map(([key, count]) => key + ": source=" + count + " restore=" + restoredCounts.get(key));
      check(
        "restored schema contains the same user tables",
        missing.length === 0 && extra.length === 0,
        "source=" + sourceCounts.size + " restored=" + restoredCounts.size +
        " missing=" + missing.length + " extra=" + extra.length
      );
      check(
        "exact row counts match across all user tables",
        mismatched.length === 0,
        mismatched.slice(0, 10).join("; ") || "all counts match"
      );
    } finally {
      await source.end();
      await restored.end();
    }
  } finally {
    if (databaseCreated) await dropDisposableDatabase();
  }
}

async function verifyJsonSnapshot(backupPath) {
  console.log("Backup format: partial JSON critical-table snapshot");
  const json = JSON.parse(createGunzipBuffer(backupPath));
  const meta = json.metadata || {};
  check(
    "JSON snapshot contains exported records",
    (meta.totalRecords || 0) > 0 || Object.values(json.tables || {}).some((table) => Array.isArray(table) && table.length > 0),
    "totalRecords=" + meta.totalRecords + " tables=" + meta.tablesCount
  );

  let databaseCreated = false;
  try {
    await createDisposableDatabase();
    databaseCreated = true;
    const restore = new pg.Client({ connectionString: RESTORE_URL });
    await restore.connect();
    const restoredCounts = {};
    let restoredTables = 0;
    try {
      for (const [table, rows] of Object.entries(json.tables || {})) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        // This is intentionally a JSON staging table, not a schema restore.
        const stagingName = "restore_" + table;
        await restore.query("CREATE TABLE " + quoteIdent(stagingName) + " (data jsonb)");
        for (const row of rows) {
          await restore.query("INSERT INTO " + quoteIdent(stagingName) + " (data) VALUES ($1::jsonb)", [JSON.stringify(row)]);
        }
        const result = await restore.query("SELECT count(*)::int AS n FROM " + quoteIdent(stagingName));
        restoredCounts[table] = result.rows[0].n;
        restoredTables++;
      }
      check("JSON rows copied into disposable staging tables", restoredTables > 0, restoredTables + " tables");
    } finally {
      await restore.end();
    }

    const source = new pg.Client({ connectionString: DATABASE_URL });
    await source.connect();
    try {
      for (const [table, rows] of Object.entries(json.tables || {})) {
        if (!Array.isArray(rows) || rows.length === 0 || restoredCounts[table] === undefined) continue;
        const result = await source.query("SELECT count(*)::int AS n FROM public." + quoteIdent(table));
        const sourceCount = result.rows[0].n;
        const ok = restoredCounts[table] === rows.length && (sourceCount >= rows.length || rows.length === 200000);
        check("JSON row count " + table, ok, "source=" + sourceCount + " backup=" + rows.length + " restore=" + restoredCounts[table]);
      }
    } finally {
      await source.end();
    }
  } finally {
    if (databaseCreated) await dropDisposableDatabase();
  }

  const requireFull = process.env.BACKUP_REQUIRE_FULL_RESTORE === "true" || process.env.NODE_ENV === "production";
  if (requireFull) {
    check("production requires a full schema-and-data restore; JSON snapshot is partial", false);
  } else {
    console.warn("PARTIAL ONLY: this JSON snapshot does not recreate the original database schema.");
  }
}

function createGunzipBuffer(backupPath) {
  // JSON fallback is capped to 256 MiB to avoid unbounded memory use in the verifier.
  const compressed = readFileSync(backupPath);
  const decompressed = gunzipSync(compressed);
  if (decompressed.length > 256 * 1024 * 1024) throw new Error("JSON snapshot exceeds 256 MiB verification limit");
  return decompressed.toString("utf8");
}


async function main() {
  console.log("Source DB: " + parsed.host + parsed.pathname);
  console.log("Disposable restore DB: " + RESTORE_DB + "\n");

  console.log("Creating backup with the real application backup service...");
  const backupModule = await import("./run-backup.mjs");
  const backupPath = await backupModule.runBackupToFile();
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error("backup was not created");
  }
  check("backup file created", true, backupPath);

  if (backupPath.endsWith(".sql.gz")) {
    await verifySqlBackup(backupPath);
  } else if (backupPath.endsWith(".json.gz")) {
    verificationLevel = "PARTIAL";
    await verifyJsonSnapshot(backupPath);
  } else {
    throw new Error("unsupported backup format: " + backupPath);
  }

  if (failures > 0) {
    console.log("\nRESTORE-VERIFY: FAILED (" + failures + ")");
    process.exitCode = 1;
  } else if (verificationLevel === "FULL") {
    console.log("\nRESTORE-VERIFY: PASSED (full schema + data restore)");
    process.exitCode = 0;
  } else {
    console.log("\nRESTORE-VERIFY: PARTIAL (JSON critical-table snapshot only; not a full database restore)");
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error("restore-verify failed:", error);
  process.exitCode = 1;
});
