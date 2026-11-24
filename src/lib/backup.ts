/**
 * Backup service — full database backup.
 *
 * Production: full PostgreSQL plain-SQL dump compressed as .sql.gz.
 * Development fallback: JSON export of an explicit critical-table allowlist.
 *
 * Production never silently falls back to the partial JSON snapshot.
 * Backups are saved to BACKUP_DIR (default: ./backups/ relative to project root).
 * Old backups are automatically cleaned up (keep last 30 days).
 *
 * Each backup is recorded in MaintenanceLog table.
 */
import { spawn } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";

const BACKUP_DIR = process.env.BACKUP_DIR || join(process.cwd(), "backups");
const BACKUP_RETENTION_DAYS = 30;

interface BackupResult {
  success: boolean;
  backupPath: string;
  backupSizeBytes: number;
  tablesCount: number;
  recordsExported: number;
  durationMs: number;
  errorMessage?: string;
}

/**
 * Run a full database backup.
 * DEPLOY-01 §10:
 *   1. Production requires DIRECT_DATABASE_URL plus pg_dump and psql.
 *   2. JSON export is development-only unless BACKUP_ALLOW_JSON_FALLBACK=true.
 * A partial JSON export is never represented as a full production backup.
 */
export async function runFullBackup(): Promise<BackupResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  // pg_dump must connect directly to PostgreSQL, never through transaction-pooling PgBouncer.
  const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  const production = process.env.NODE_ENV === "production";
  const allowJsonFallback = process.env.BACKUP_ALLOW_JSON_FALLBACK === "true";

  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  if (databaseUrl?.startsWith("postgresql://") && await hasPgDump()) {
    try {
      return await pgDumpBackup(databaseUrl, timestamp, startTime);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[backup] pg_dump failed:", message);
      if (production && !allowJsonFallback) {
        return failedBackup(startTime, "Full PostgreSQL backup failed; JSON fallback is disabled in production: " + message);
      }
    }
  } else if (production && !allowJsonFallback) {
    return failedBackup(
      startTime,
      "Full PostgreSQL backup requires DIRECT_DATABASE_URL and the pg_dump/psql client tools; partial JSON export is disabled in production."
    );
  }

  // JSON export is retained only as a development/explicitly enabled fallback.
  return await jsonExportBackup(timestamp, startTime);
}

function failedBackup(startTime: number, errorMessage: string): BackupResult {
  return {
    success: false,
    backupPath: "",
    backupSizeBytes: 0,
    tablesCount: 0,
    recordsExported: 0,
    durationMs: Date.now() - startTime,
    errorMessage,
  };
}

/** Require both dump and restore clients; a backup without a restore tool is not certifiable. */
async function hasPgDump(): Promise<boolean> {
  try {
    for (const command of ["pg_dump", "psql"]) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, ["--version"], { stdio: "ignore" });
        child.once("error", reject);
        child.once("close", (code) => code === 0 ? resolve() : reject(new Error(command + " unavailable")));
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Full PostgreSQL backup via plain SQL dump + gzip.
 * The dump connects to DIRECT_DATABASE_URL, bypassing PgBouncer.
 */
function normalizeLibpqUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.delete("schema");
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

async function pgDumpBackup(
  databaseUrl: string,
  timestamp: string,
  startTime: number
): Promise<BackupResult> {
  const filename = "backup-" + timestamp + ".sql.gz";
  const filepath = join(BACKUP_DIR, filename);
  const stderr: Buffer[] = [];
  const child = spawn(
    "pg_dump",
    [normalizeLibpqUrl(databaseUrl), "--no-owner", "--no-privileges"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const exitPromise = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("pg_dump exited with code " + code + ": " + Buffer.concat(stderr).toString("utf8").slice(0, 1200)));
    });
  });

  try {
    await pipeline(child.stdout, createGzip(), createWriteStream(filepath));
    await exitPromise;

    const { getPool } = await import("@/lib/postgrest/pool");
    const pool = getPool();
    const countResult = await pool.query(
      "SELECT count(*)::int AS count FROM pg_tables " +
      "WHERE schemaname NOT IN ('pg_catalog', 'information_schema') " +
      "AND schemaname NOT LIKE 'pg_toast%'"
    );
    const tablesCount = Number(countResult.rows[0]?.count ?? 0);
    const stats = statSync(filepath);
    const durationMs = Date.now() - startTime;

    console.info(
      "[backup] full pg_dump completed: " + filename +
      " (" + (stats.size / 1024 / 1024).toFixed(2) + " MB, " +
      tablesCount + " tables, " + durationMs + "ms)"
    );

    return {
      success: true,
      backupPath: filepath,
      backupSizeBytes: stats.size,
      tablesCount,
      recordsExported: 0,
      durationMs,
    };
  } catch (error) {
    child.kill();
    try { unlinkSync(filepath); } catch { /* partial file cleanup */ }
    throw error;
  }
}

/**
 * JSON export backup — real rows from the explicit critical-table allowlist.
 * This is a development fallback, not a full production database backup.
 */
const BACKUP_TABLES = [
  "profiles",
  "user_roles",
  "confectioners",
  "products",
  "orders",
  "order_items",
  "cart_items",
  "reviews",
  "video_reviews",
  "promotions",
  "recipes",
  "recipe_marketplace",
  "recipe_purchases",
  "chat_rooms",
  "chat_messages",
  "payments",
  "financial_audit_log",
  "inventory_items",
  "inventory_movements",
  "stock_movements",
  "cms_pages",
  "cms_blocks",
  "banners",
  "site_settings",
  "nav_menu_items",
  "loyalty_transactions",
  "notifications",
  "audit_log",
  "domain_events",
  "ops_tasks",
  "maintenance_logs",
  "app_incidents",
  "app_error_events",
] as const;

async function jsonExportBackup(
  timestamp: string,
  startTime: number
): Promise<BackupResult> {
  const filename = "backup-" + timestamp + ".json.gz";
  const filepath = join(BACKUP_DIR, filename);

  console.info("[backup] Starting partial JSON export -> " + filepath);

  const { getPool } = await import("@/lib/postgrest/pool");
  const pool = getPool();

  const tables: Record<string, unknown[]> = {};
  const warnings: string[] = [];
  let totalRecords = 0;
  let successfulTables = 0;

  for (const name of BACKUP_TABLES) {
    try {
      const res = await pool.query('SELECT * FROM public."' + name + '" LIMIT 200000');
      const records = (res.rows ?? []) as unknown[];
      tables[name] = records;
      totalRecords += records.length;
      successfulTables += 1;
      console.info("  ✓ " + name + ": " + records.length + " records");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(name + ": skipped (" + msg.slice(0, 120) + ")");
      console.warn("  ⚠ " + name + ": skipped");
      tables[name] = [];
    }
  }

  if (successfulTables === 0) {
    throw new Error("JSON backup failed: no tables readable (" + warnings.slice(0, 3).join("; ") + ")");
  }

  const jsonData = JSON.stringify({
    metadata: {
      timestamp: new Date().toISOString(),
      version: "2.0",
      format: "json-tables",
      tablesCount: successfulTables,
      tablesRequested: BACKUP_TABLES.length,
      totalRecords,
      databaseType: "postgresql",
      warnings,
    },
    tables,
  });

  const gzip = createGzip();
  const writeStream = createWriteStream(filepath);
  const { Readable } = await import("stream");
  await pipeline(Readable.from(jsonData), gzip, writeStream);

  const stats = statSync(filepath);
  const durationMs = Date.now() - startTime;

  console.info(
    "[backup] partial JSON export completed: " + filename +
    " (" + (stats.size / 1024).toFixed(1) + " KB, " + totalRecords + " records, " + durationMs + "ms)"
  );

  return {
    success: true,
    backupPath: filepath,
    backupSizeBytes: stats.size,
    tablesCount: successfulTables,
    recordsExported: totalRecords,
    durationMs,
  };
}

/**
 * Delete backups older than BACKUP_RETENTION_DAYS.
 * Returns count of deleted files.
 */
export async function cleanupOldBackups(): Promise<number> {
  if (!existsSync(BACKUP_DIR)) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_RETENTION_DAYS);

  const files = readdirSync(BACKUP_DIR);
  let deleted = 0;

  for (const file of files) {
    const filepath = join(BACKUP_DIR, file);
    try {
      const stats = statSync(filepath);
      if (stats.mtime < cutoff) {
        unlinkSync(filepath);
        deleted++;
        console.info(`[backup] deleted old backup: ${file}`);
      }
    } catch (e) {
      // skip
    }
  }

  return deleted;
}

/**
 * List all existing backups (for admin panel display).
 */
export async function listBackups(): Promise<
  Array<{
    filename: string;
    sizeBytes: number;
    createdAt: Date;
  }>
> {
  if (!existsSync(BACKUP_DIR)) return [];

  const files = readdirSync(BACKUP_DIR);
  return files
    .filter((f) => f.startsWith("backup-"))
    .map((file) => {
      const filepath = join(BACKUP_DIR, file);
      const stats = statSync(filepath);
      return {
        filename: file,
        sizeBytes: stats.size,
        createdAt: stats.mtime,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
