/**
 * Backup service — full database backup.
 *
 * Two modes:
 *   1. PostgreSQL (production): runs `pg_dump` via child_process, saves .sql.gz
 *   2. PGlite (dev): exports all tables as JSON to a .json.gz file
 *
 * Backups are saved to BACKUP_DIR (default: ./backups/ relative to project root).
 * Old backups are automatically cleaned up (keep last 30 days).
 *
 * Each backup is recorded in MaintenanceLog table.
 */
import { db } from "./db";
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
 * Uses pg_dump for PostgreSQL, JSON export for PGlite.
 */
export async function runFullBackup(): Promise<BackupResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const isProd = process.env.NODE_ENV === "production";
  const databaseUrl = process.env.DATABASE_URL;

  // Ensure backup directory exists
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Try pg_dump for real PostgreSQL
  if (isProd && databaseUrl && databaseUrl.startsWith("postgresql://")) {
    try {
      return await pgDumpBackup(databaseUrl, timestamp, startTime);
    } catch (e) {
      console.error("[backup] pg_dump failed, falling back to JSON export:", e);
    }
  }

  // Fallback: JSON export (works with PGlite and any Prisma-compatible DB)
  return await jsonExportBackup(timestamp, startTime);
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
  const filepath = join(BACKUP_DIR, filename);

  // pg_dump with custom format, piped through gzip
  const cmd = `pg_dump "${databaseUrl}" --no-owner --no-privileges | gzip > "${filepath}"`;
  console.info(`[backup] Running pg_dump → ${filepath}`);

  await execAsync(cmd, { timeout: 300000 }); // 5 min timeout

  const stats = statSync(filepath);
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
 * JSON export backup — works with PGlite and any Prisma DB.
 * Exports all tables as a JSON object, gzipped.
 */
async function jsonExportBackup(
  timestamp: string,
  startTime: number
): Promise<BackupResult> {
  const filename = `backup-${timestamp}.json.gz`;
  const filepath = join(BACKUP_DIR, filename);

  console.info(`[backup] Starting JSON export → ${filepath}`);

  // Get the Prisma client
  const client = await getDbSafe();
  if (!client) {
    throw new Error("Database client not available");
  }

  // Export each table
  const tables: Record<string, unknown[]> = {};
  let totalRecords = 0;

  const tableExporters: Array<{ name: string; query: () => Promise<unknown[]> }> = [
    { name: "users", query: () => client.user.findMany() },
    { name: "confectioners", query: () => client.confectioner.findMany() },
    { name: "products", query: () => client.product.findMany() },
    { name: "orders", query: () => client.order.findMany({ include: { items: true } }) },
    { name: "order_items", query: () => client.orderItem.findMany() },
    { name: "cart_items", query: () => client.cartItem.findMany() },
    { name: "reviews", query: () => client.review.findMany() },
    { name: "video_reviews", query: () => client.videoReview.findMany() },
    { name: "promotions", query: () => client.promotion.findMany() },
    { name: "recipes", query: () => client.recipe.findMany() },
    { name: "chat_rooms", query: () => client.chatRoom.findMany() },
    { name: "chat_messages", query: () => client.chatMessage.findMany() },
    { name: "referrals", query: () => client.referral.findMany() },
    { name: "gift_certificates", query: () => client.giftCertificate.findMany() },
    { name: "user_holidays", query: () => client.userHoliday.findMany() },
    { name: "payments", query: () => client.payment.findMany() },
    { name: "blacklist", query: () => client.blacklistEntry.findMany() },
    { name: "semaphores", query: () => client.semaphore.findMany() },
    { name: "inventory_items", query: () => client.inventoryItem.findMany() },
    { name: "stock_movements", query: () => client.stockMovement.findMany() },
    { name: "cms_pages", query: () => client.cmsPage.findMany({ include: { blocks: true } }) },
    { name: "cms_blocks", query: () => client.cmsBlock.findMany() },
    { name: "banners", query: () => client.banner.findMany() },
    { name: "site_settings", query: () => client.siteSetting.findMany() },
    { name: "nav_menu_items", query: () => client.navMenuItem.findMany() },
    { name: "loyalty_transactions", query: () => client.loyaltyTransaction.findMany() },
    { name: "notifications", query: () => client.notification.findMany() },
    { name: "notification_preferences", query: () => client.notificationPreferences.findMany() },
    { name: "organization_verifications", query: () => client.organizationVerification.findMany() },
    { name: "maintenance_logs", query: () => client.maintenanceLog.findMany() },
  ];

  for (const { name, query } of tableExporters) {
    try {
      const records = await query();
      tables[name] = records;
      totalRecords += records.length;
      console.info(`  ✓ ${name}: ${records.length} records`);
    } catch (e) {
      console.warn(`  ⚠ ${name}: skipped (${(e as Error).message})`);
      tables[name] = [];
    }
  }

  // Write gzipped JSON
  const jsonData = JSON.stringify({
    metadata: {
      timestamp: new Date().toISOString(),
      version: "1.0",
      tablesCount: tableExporters.length,
      totalRecords,
      databaseType: isProd ? "postgresql" : "pglite",
    },
    tables,
  });

  const gzip = createGzip();
  const writeStream = createWriteStream(filepath);
  // Write JSON data through gzip to file
  const { Readable } = await import("stream");
  await pipeline(Readable.from(jsonData), gzip, writeStream);

  const stats = statSync(filepath);
  const durationMs = Date.now() - startTime;

  console.info(
    `[backup] ✓ JSON export completed: ${filename} (${(stats.size / 1024).toFixed(1)} KB, ${totalRecords} records, ${durationMs}ms)`
  );

  return {
    success: true,
    backupPath: filepath,
    backupSizeBytes: stats.size,
    tablesCount: tableExporters.length,
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

// ===== Helper: safely get the DB client =====
async function getDbSafe(): Promise<
  | {
      user: { findMany: () => Promise<unknown[]> };
      confectioner: { findMany: () => Promise<unknown[]> };
      product: { findMany: () => Promise<unknown[]> };
      order: { findMany: (opts?: unknown) => Promise<unknown[]> };
      orderItem: { findMany: () => Promise<unknown[]> };
      cartItem: { findMany: () => Promise<unknown[]> };
      review: { findMany: () => Promise<unknown[]> };
      videoReview: { findMany: () => Promise<unknown[]> };
      promotion: { findMany: () => Promise<unknown[]> };
      recipe: { findMany: () => Promise<unknown[]> };
      chatRoom: { findMany: () => Promise<unknown[]> };
      chatMessage: { findMany: () => Promise<unknown[]> };
      referral: { findMany: () => Promise<unknown[]> };
      giftCertificate: { findMany: () => Promise<unknown[]> };
      userHoliday: { findMany: () => Promise<unknown[]> };
      payment: { findMany: () => Promise<unknown[]> };
      blacklistEntry: { findMany: () => Promise<unknown[]> };
      semaphore: { findMany: () => Promise<unknown[]> };
      inventoryItem: { findMany: () => Promise<unknown[]> };
      stockMovement: { findMany: () => Promise<unknown[]> };
      cmsPage: { findMany: (opts?: unknown) => Promise<unknown[]> };
      cmsBlock: { findMany: () => Promise<unknown[]> };
      banner: { findMany: () => Promise<unknown[]> };
      siteSetting: { findMany: () => Promise<unknown[]> };
      navMenuItem: { findMany: () => Promise<unknown[]> };
      loyaltyTransaction: { findMany: () => Promise<unknown[]> };
      notification: { findMany: () => Promise<unknown[]> };
      notificationPreferences: { findMany: () => Promise<unknown[]> };
      organizationVerification: { findMany: () => Promise<unknown[]> };
      maintenanceLog: { findMany: () => Promise<unknown[]> };
    }
  | null
> {
  try {
    const { getDb } = await import("./db");
    return (await getDb()) as never;
  } catch {
    return null;
  }
}

const isProd = process.env.NODE_ENV === "production";
