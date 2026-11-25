#!/usr/bin/env node
/**
 * Проверяет полный PostgreSQL backup реальным восстановлением SQL dump.
 *
 * Порядок:
 * 1. Создать backup штатным production backup-сервисом (pg_dump + gzip).
 * 2. Создать отдельную disposable-БД на BACKUP_RESTORE_DATABASE_URL.
 * 3. Восстановить SQL dump через psql в эту БД.
 * 4. Сверить состав таблиц и количество строк source ↔ restore.
 * 5. Удалить только созданную этим запуском disposable-БД.
 *
 * Частичный JSON export намеренно не принимается как полный backup.
 * Для отдельного restore-кластера можно задать:
 * BACKUP_RESTORE_DATABASE_URL — URL административной БД (обычно /postgres);
 * BACKUP_RESTORE_PSQL_URL — URL целевой БД внутри окружения psql;
 * BACKUP_RESTORE_DB_NAME — имя одноразовой БД.
 */
import { readFileSync, existsSync, createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import pg from "pg";

function loadSourceUrl() {
  for (const key of ["DIRECT_DATABASE_URL", "PGURL", "DATABASE_URL"]) {
    const value = process.env[key];
    if (value && /^postgres(?:ql)?:\/\//.test(value)) return value;
  }
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^(?:DIRECT_DATABASE_URL|DATABASE_URL)=(.+)$/);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("DIRECT_DATABASE_URL / DATABASE_URL is required");
}

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

const SOURCE_URL = loadSourceUrl();
const RESTORE_ADMIN_URL = process.env.BACKUP_RESTORE_DATABASE_URL || SOURCE_URL;
const RESTORE_DB = process.env.BACKUP_RESTORE_DB_NAME ||
  "conditera_restore_verify_" + Date.now();

const restoreDatabaseUrl = new URL(RESTORE_ADMIN_URL);
restoreDatabaseUrl.pathname = "/" + RESTORE_DB;
restoreDatabaseUrl.searchParams.delete("schema");
restoreDatabaseUrl.searchParams.delete("pgbouncer");
const RESTORE_DATABASE_URL = restoreDatabaseUrl.toString();

const RESTORE_PSQL_URL = process.env.BACKUP_RESTORE_PSQL_URL || RESTORE_DATABASE_URL;

async function getTableCounts(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT table_schema, table_name " +
      "FROM information_schema.tables " +
      "WHERE table_type = 'BASE TABLE' " +
      "AND table_schema NOT IN ('pg_catalog', 'information_schema') " +
      "AND table_schema NOT LIKE 'pg_toast%' " +
      "ORDER BY table_schema, table_name"
    );
    const counts = new Map();
    for (const row of result.rows) {
      const key = row.table_schema + "." + row.table_name;
      const sql = "SELECT count(*)::bigint AS count FROM " +
        quoteIdentifier(row.table_schema) + "." + quoteIdentifier(row.table_name);
      const count = await client.query(sql);
      counts.set(key, Number(count.rows[0].count));
    }
    return counts;
  } finally {
    await client.end();
  }
}

async function restoreSqlDump(backupPath) {
  const stderr = [];
  const child = spawn("psql", [
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    "--quiet",
    "--dbname",
    RESTORE_PSQL_URL,
  ], { stdio: ["pipe", "ignore", "pipe"] });

  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const exitPromise = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(
        "psql restore exited with code " + code + ": " +
        Buffer.concat(stderr).toString("utf8").slice(0, 3000)
      ));
    });
  });

  try {
    await Promise.all([
      pipeline(createReadStream(backupPath), createGunzip(), child.stdin),
      exitPromise,
    ]);
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function main() {
  console.log("Source DB: " + new URL(SOURCE_URL).host + new URL(SOURCE_URL).pathname);
  console.log("Restore target: " + new URL(RESTORE_ADMIN_URL).host + "/" + RESTORE_DB);

  console.log("\n── 1. Создание полного PostgreSQL backup");
  const backupModule = await import("./run-backup.mjs");
  const backupPath = await backupModule.runBackupToFile();
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error("Backup service did not produce a backup file");
  }
  if (!backupPath.endsWith(".sql.gz")) {
    throw new Error(
      "Full restore verification requires a .sql.gz pg_dump; partial JSON backups are not full backups: " +
      backupPath
    );
  }
  console.log("✓ Full SQL backup created: " + backupPath);

  console.log("\n── 2. Создание отдельной disposable-БД");
  const admin = new pg.Client({ connectionString: RESTORE_ADMIN_URL });
  let databaseCreated = false;
  try {
    await admin.connect();
    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [RESTORE_DB]
    );
    if (existing.rowCount > 0) {
      throw new Error("Refusing to overwrite an existing restore database: " + RESTORE_DB);
    }
    await admin.query("CREATE DATABASE " + quoteIdentifier(RESTORE_DB));
    databaseCreated = true;
  } finally {
    await admin.end();
  }

  try {
    console.log("\n── 3. Реальное восстановление SQL dump через psql");
    await restoreSqlDump(backupPath);
    console.log("✓ SQL dump restored");

    console.log("\n── 4. Сверка таблиц и количества строк");
    const [sourceCounts, restoredCounts] = await Promise.all([
      getTableCounts(SOURCE_URL),
      getTableCounts(RESTORE_DATABASE_URL),
    ]);

    const missing = [...sourceCounts.keys()].filter((key) => !restoredCounts.has(key));
    const extra = [...restoredCounts.keys()].filter((key) => !sourceCounts.has(key));
    const mismatched = [...sourceCounts.entries()]
      .filter(([key, count]) => restoredCounts.has(key) && restoredCounts.get(key) !== count)
      .map(([key, count]) => ({
        table: key,
        source: count,
        restored: restoredCounts.get(key),
      }));

    console.log("Source tables: " + sourceCounts.size);
    console.log("Restored tables: " + restoredCounts.size);
    if (missing.length) console.error("Missing tables: " + missing.join(", "));
    if (extra.length) console.error("Unexpected tables: " + extra.join(", "));
    if (mismatched.length) console.error("Row count mismatches: " + JSON.stringify(mismatched));

    if (missing.length || extra.length || mismatched.length || sourceCounts.size === 0) {
      throw new Error("Restored database does not match the source database");
    }
    console.log("✓ Table inventory and row counts match");
  } finally {
    if (databaseCreated) {
      console.log("\n── 5. Удаление только созданной disposable-БД");
      const cleanup = new pg.Client({ connectionString: RESTORE_ADMIN_URL });
      await cleanup.connect();
      try {
        await cleanup.query("DROP DATABASE " + quoteIdentifier(RESTORE_DB));
        const remains = await cleanup.query(
          "SELECT 1 FROM pg_database WHERE datname = $1",
          [RESTORE_DB]
        );
        if (remains.rowCount > 0) {
          throw new Error("Disposable restore database was not removed");
        }
        console.log("✓ Disposable database removed; source database was not modified");
      } finally {
        await cleanup.end();
      }
    }
  }

  console.log("\nFULL BACKUP RESTORE VERIFICATION: PASSED");
}

main().catch((error) => {
  console.error("restore-verify failed:", error);
  process.exitCode = 1;
});
