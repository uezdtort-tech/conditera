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
import { readFileSync, existsSync, createReadStream, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
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

async function sha256File(filepath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filepath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function restoreTarArchive(archivePath, expectedEntry, expectedContent) {
  const stderr = [];
  const restoreDir = mkdtempSync(join(tmpdir(), "conditera-media-restore-"));
  try {
    const child = spawn("tar", ["-xzf", archivePath, "-C", restoreDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) {
          reject(new Error(
            "tar restore failed for " + archivePath + ": " +
            Buffer.concat(stderr).toString("utf8").slice(0, 2000)
          ));
        } else resolve();
      });
    });

    if (expectedEntry) {
      const parts = expectedEntry.split("/");
      if (parts.some((part) => !part || part === "." || part === "..")) {
        throw new Error("Unsafe expected media path: " + expectedEntry);
      }
      const restoredPath = join(restoreDir, ...parts);
      if (!existsSync(restoredPath)) {
        throw new Error("Expected media file is absent after restore: " + expectedEntry);
      }
      if (expectedContent !== undefined) {
        const actual = readFileSync(restoredPath, "utf8").trim();
        if (actual !== expectedContent) {
          throw new Error("Restored media content mismatch: " + expectedEntry);
        }
      }
    }
  } finally {
    rmSync(restoreDir, { recursive: true, force: true });
  }
}


async function verifyBackupManifest(backupPath) {
  const manifestPath = backupPath.replace(/\.sql\.gz$/, ".manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("Full backup manifest is missing: " + manifestPath);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.format !== "conditera-full-backup-manifest-v1" || !Array.isArray(manifest.artifacts)) {
    throw new Error("Backup manifest format is invalid");
  }

  const expectedKinds = ["database_sql"];
  if (process.env.NODE_ENV === "production" || process.env.BACKUP_INCLUDE_MEDIA === "true") {
    expectedKinds.push("product_media", "supabase_storage");
  }
  const byKind = new Map(manifest.artifacts.map((artifact) => [artifact.kind, artifact]));
  for (const kind of expectedKinds) {
    if (!byKind.has(kind)) throw new Error("Backup manifest is missing required artifact: " + kind);
  }

  for (const artifact of manifest.artifacts) {
    if (!artifact.file || basename(artifact.file) !== artifact.file) {
      throw new Error("Unsafe artifact filename in backup manifest");
    }
    const artifactPath = join(dirname(backupPath), artifact.file);
    if (!existsSync(artifactPath)) throw new Error("Backup artifact is missing: " + artifact.file);
    const stats = statSync(artifactPath);
    if (stats.size !== Number(artifact.sizeBytes)) {
      throw new Error("Backup artifact size mismatch: " + artifact.file);
    }
    const checksum = await sha256File(artifactPath);
    if (checksum !== artifact.sha256) {
      throw new Error("Backup artifact SHA-256 mismatch: " + artifact.file);
    }
    if (artifact.kind === "product_media") {
      await restoreTarArchive(artifactPath, process.env.BACKUP_EXPECT_PRODUCT_MEDIA_FILE, process.env.BACKUP_EXPECT_PRODUCT_MEDIA_CONTENT);
    } else if (artifact.kind === "supabase_storage") {
      await restoreTarArchive(artifactPath, process.env.BACKUP_EXPECT_SUPABASE_STORAGE_FILE, process.env.BACKUP_EXPECT_SUPABASE_STORAGE_CONTENT);
    }
  }

  const databaseArtifact = byKind.get("database_sql");
  if (databaseArtifact.file !== basename(backupPath) ||
      manifest.database?.file !== basename(backupPath) ||
      manifest.database?.sha256 !== databaseArtifact.sha256) {
    throw new Error("Database dump does not match the backup manifest");
  }
  if (expectedKinds.includes("product_media") && manifest.scope?.productMedia !== true) {
    throw new Error("Manifest does not certify product media backup");
  }
  if (expectedKinds.includes("supabase_storage") && manifest.scope?.supabaseStorage !== true) {
    throw new Error("Manifest does not certify Supabase Storage backup");
  }

  console.log("✓ Backup manifest, SHA-256 checksums and media archives verified");
  return manifestPath;
}

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
  await verifyBackupManifest(backupPath);

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
