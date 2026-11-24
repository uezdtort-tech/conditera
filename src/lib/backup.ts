/**
 * Backup service — full database backup.
 *
 * Two modes:
 *   1. PostgreSQL (pg_dump available): runs `pg_dump` via child_process, saves .sql.gz
 *   2. Any PostgreSQL (dev embedded / Supabase): JSON export of real rows via pg pool
 *
 * Backups are saved to BACKUP_DIR (default: ./backups/ relative to project root).
 * Old backups are automatically cleaned up (keep last 30 days).
 *
 * Each backup is recorded in MaintenanceLog table.
 */
import { exec } from "child_process";
import { promisify } from "util";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";

const execAsync = promisify(exec);

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
 *   1. pg_dump — если доступен бинарь и DATABASE_URL postgresql:// (любая среда);
 *   2. JSON-export через pg-пул — рабочая альтернатива (ранее fallback был
 *      на Prisma-синтаксисе и на supabase-js всегда возвращал пустые таблицы
 *      с status "success" — баг закрыт: записи реально читаются из БД).
 * Итог честный: если ни один путь не смог прочитать данные — success:false.
 */
export async function runFullBackup(): Promise<BackupResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const databaseUrl = process.env.DATABASE_URL;

  // Ensure backup directory exists
  if (!existsSync(/* turbopackIgnore: true */ BACKUP_DIR)) {
    mkdirSync(/* turbopackIgnore: true */ BACKUP_DIR, { recursive: true });
  }

  // Try pg_dump for real PostgreSQL (если бинарь доступен)
  if (databaseUrl && databaseUrl.startsWith("postgresql://") && (await hasPgDump())) {
    try {
      return await pgDumpBackup(databaseUrl, timestamp, startTime);
    } catch (e) {
      console.error("[backup] pg_dump failed, falling back to JSON export:", e);
    }
  }

  // Fallback: JSON export через pg-пул (реальные строки)
  return await jsonExportBackup(timestamp, startTime);
}

/** Проверка доступности бинаря pg_dump (без shell-инъекции — только which). */
async function hasPgDump(): Promise<boolean> {
  try {
    await execAsync("which pg_dump", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * PostgreSQL backup via pg_dump.
 */
async function pgDumpBackup(
  databaseUrl: string,
  timestamp: string,
  startTime: number
): Promise<BackupResult> {
  const filename = `backup-${timestamp}.sql.gz`;
  const filepath = join(/* turbopackIgnore: true */ BACKUP_DIR, filename);

  // pg_dump with custom format, piped through gzip
  const cmd = `pg_dump "${databaseUrl}" --no-owner --no-privileges | gzip > "${filepath}"`;
  console.info(`[backup] Running pg_dump → ${filepath}`);

  await execAsync(cmd, { timeout: 300000 }); // 5 min timeout

  const stats = statSync(/* turbopackIgnore: true */ filepath);
  const durationMs = Date.now() - startTime;

  // Count tables
  const { stdout } = await execAsync(
    `pg_dump "${databaseUrl}" --list | grep -c "^- "`
  );
  const tablesCount = parseInt(stdout.trim()) || 0;

  console.info(
    `[backup] ✓ pg_dump completed: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${durationMs}ms)`
  );

  return {
    success: true,
    backupPath: filepath,
    backupSizeBytes: stats.size,
    tablesCount,
    recordsExported: 0, // pg_dump doesn't report this
    durationMs,
  };
}

/**
 * JSON export backup — реальные строки через pg-пул (Supabase/embedded PG).
 *
 * DEPLOY-01: предыдущая реализация использовала Prisma-синтаксис
 * (client.user.findMany()) на supabase-js shim — каждая таблица падала в
 * catch и экспорт завершался «успехом» с 0 записей. Теперь — SQL SELECT
 * по явному списку таблиц; таблица, которой нет в схеме, честно помечается
 * skipped в warnings, а итоговый success зависит от того, прочитана ли
 * хотя бы часть данных.
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
  const filename = `backup-${timestamp}.json.gz`;
  const filepath = join(/* turbopackIgnore: true */ BACKUP_DIR, filename);

  console.info(`[backup] Starting JSON export → ${filepath}`);

  const { getPool } = await import("@/lib/postgrest/pool");
  const pool = getPool();

  const tables: Record<string, unknown[]> = {};
  const warnings: string[] = [];
  let totalRecords = 0;
  let successfulTables = 0;

  for (const name of BACKUP_TABLES) {
    try {
      const res = await pool.query(`SELECT * FROM public."${name}" LIMIT 200000`);
      const records = (res.rows ?? []) as unknown[];
      tables[name] = records;
      totalRecords += records.length;
      successfulTables += 1;
      console.info(`  ✓ ${name}: ${records.length} records`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`${name}: skipped (${msg.slice(0, 120)})`);
      console.warn(`  ⚠ ${name}: skipped`);
      tables[name] = [];
    }
  }

  // Честный итог (§19): если ни одна таблица не прочитана — failure
  if (successfulTables === 0) {
    throw new Error(
      `JSON backup failed: no tables readable (${warnings.slice(0, 3).join("; ")})`
    );
  }

  // Write gzipped JSON
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
  const writeStream = createWriteStream(/* turbopackIgnore: true */ filepath);
  const { Readable } = await import("stream");
  await pipeline(Readable.from(jsonData), gzip, writeStream);

  const stats = statSync(/* turbopackIgnore: true */ filepath);
  const durationMs = Date.now() - startTime;

  console.info(
    `[backup] ✓ JSON export completed: ${filename} (${(stats.size / 1024).toFixed(1)} KB, ${totalRecords} records, ${durationMs}ms)`
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
  if (!existsSync(/* turbopackIgnore: true */ BACKUP_DIR)) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_RETENTION_DAYS);

  const files = readdirSync(/* turbopackIgnore: true */ BACKUP_DIR);
  let deleted = 0;

  for (const file of files) {
    const filepath = join(/* turbopackIgnore: true */ BACKUP_DIR, file);
    try {
      const stats = statSync(/* turbopackIgnore: true */ filepath);
      if (stats.mtime < cutoff) {
        unlinkSync(/* turbopackIgnore: true */ filepath);
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
  if (!existsSync(/* turbopackIgnore: true */ BACKUP_DIR)) return [];

  const files = readdirSync(/* turbopackIgnore: true */ BACKUP_DIR);
  return files
    .filter((f) => f.startsWith("backup-"))
    .map((file) => {
      const filepath = join(/* turbopackIgnore: true */ BACKUP_DIR, file);
      const stats = statSync(/* turbopackIgnore: true */ filepath);
      return {
        filename: file,
        sizeBytes: stats.size,
        createdAt: stats.mtime,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
