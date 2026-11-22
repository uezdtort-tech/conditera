/**
 * PostgreSQL backup service.
 *
 * Production backups use a dedicated read-only BYPASSRLS role and pg_dump.
 * The dump is streamed through gzip into a temporary file and atomically renamed
 * only after pg_dump exits successfully. A failed dump is never reported as a
 * successful empty JSON backup.
 */
import { spawn } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";

const BACKUP_DIR = process.env.BACKUP_DIR || join(process.cwd(), "backups");
const BACKUP_RETENTION_DAYS = 30;
const PG_DUMP_TIMEOUT_MS = 300_000;

interface BackupResult {
  success: boolean;
  backupPath: string;
  backupSizeBytes: number;
  tablesCount: number;
  recordsExported: number;
  durationMs: number;
  errorMessage?: string;
}

function parsePgDumpConnection(databaseUrl: string): { connectionString: string; password: string } {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Backup connection URL must use postgres:// or postgresql://");
  }

  const password = decodeURIComponent(parsed.password);
  parsed.password = "";

  // These are Prisma/pooler-only query parameters, not libpq connection options.
  for (const key of ["schema", "pgbouncer", "connection_limit", "pool_timeout"]) {
    parsed.searchParams.delete(key);
  }

  return { connectionString: parsed.toString(), password };
}

/**
 * Run a complete PostgreSQL backup. Production requires the dedicated backup
 * connection; it must never silently fall back to the less-privileged app role.
 */
export async function runFullBackup(): Promise<BackupResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const isProd = process.env.NODE_ENV === "production";
  const databaseUrl = isProd
    ? process.env.BACKUP_DATABASE_URL
    : process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      isProd
        ? "BACKUP_DATABASE_URL is required in production"
        : "A PostgreSQL DATABASE_URL is required to create a backup"
    );
  }
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("Database backup requires PostgreSQL; JSON/Prisma fallback is disabled");
  }

  if (!existsSync(/*turbopackIgnore: true*/ BACKUP_DIR)) {
    mkdirSync(/*turbopackIgnore: true*/ BACKUP_DIR, { recursive: true, mode: 0o700 });
  }
  chmodSync(/*turbopackIgnore: true*/ BACKUP_DIR, 0o700);

  return pgDumpBackup(databaseUrl, timestamp, startTime);
}

/**
 * pg_dump → gzip → temporary file → atomic rename.
 * A separate connection counts tables so the backup metadata is not inferred
 * from brittle parsing of pg_dump's human-readable output.
 */
async function pgDumpBackup(
  databaseUrl: string,
  timestamp: string,
  startTime: number
): Promise<BackupResult> {
  const filename = `backup-${timestamp}.sql.gz`;
  const filepath = join(BACKUP_DIR, filename);
  const tempFile = `${filepath}.tmp`;
  const { connectionString, password } = parsePgDumpConnection(databaseUrl);

  const db = new Client({
    connectionString,
    ...(password ? { password } : {}),
    connectionTimeoutMillis: 10_000,
  });
  let tablesCount = 0;
  try {
    await db.connect();
    const result = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE'
         AND table_schema NOT IN ('pg_catalog', 'information_schema')`
    );
    tablesCount = Number(result.rows[0]?.count || 0);
  } finally {
    await db.end().catch(() => undefined);
  }

  console.info(`[backup] Running pg_dump → ${filepath}`);
  const child = spawn(
    "pg_dump",
    [connectionString, "--no-owner", "--no-privileges"],
    {
      env: {
        ...process.env,
        ...(password ? { PGPASSWORD: password } : {}),
        PGAPPNAME: "conditera-production-backup",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (!child.stdout || !child.stderr) {
    child.kill("SIGTERM");
    throw new Error("Unable to open pg_dump output streams");
  }

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-8000);
  });

  let timedOut = false;
  const processResult = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (timedOut) {
        reject(new Error(`pg_dump exceeded ${PG_DUMP_TIMEOUT_MS}ms timeout`));
      } else if (code !== 0) {
        reject(
          new Error(
            `pg_dump exited with code ${code ?? "unknown"} signal ${signal ?? "none"}: ${stderr || "no stderr"}`
          )
        );
      } else {
        resolve();
      }
    });
  });

  const outputResult = pipeline(
    child.stdout,
    createGzip(),
    createWriteStream(/*turbopackIgnore: true*/ tempFile, { flags: "wx", mode: 0o600 })
  );
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, PG_DUMP_TIMEOUT_MS);

  try {
    await Promise.all([outputResult, processResult]);
    renameSync(/*turbopackIgnore: true*/ tempFile, /*turbopackIgnore: true*/ filepath);
  } catch (error) {
    child.kill("SIGTERM");
    await Promise.allSettled([outputResult, processResult]);
    try {
      unlinkSync(/*turbopackIgnore: true*/ tempFile);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const stats = statSync(/*turbopackIgnore: true*/ filepath);
  if (stats.size <= 0) {
    try {
      unlinkSync(/*turbopackIgnore: true*/ filepath);
    } catch {
      // Preserve the original zero-byte backup error.
    }
    throw new Error("pg_dump produced an empty backup file");
  }

  const durationMs = Date.now() - startTime;
  console.info(
    `[backup] ✓ pg_dump completed: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${tablesCount} tables, ${durationMs}ms)`
  );

  return {
    success: true,
    backupPath: filepath,
    backupSizeBytes: stats.size,
    tablesCount,
    recordsExported: 0,
    durationMs,
  };
}

/**
 * Delete backups older than BACKUP_RETENTION_DAYS.
 * Returns count of deleted files.
 */
export async function cleanupOldBackups(): Promise<number> {
  if (!existsSync(/*turbopackIgnore: true*/ BACKUP_DIR)) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_RETENTION_DAYS);

  const files = readdirSync(/*turbopackIgnore: true*/ BACKUP_DIR);
  let deleted = 0;

  for (const file of files) {
    if (!file.startsWith("backup-") || !file.endsWith(".gz")) continue;
    const filepath = join(/*turbopackIgnore: true*/ BACKUP_DIR, file);
    try {
      const stats = statSync(/*turbopackIgnore: true*/ filepath);
      if (stats.isFile() && stats.mtime < cutoff) {
        unlinkSync(/*turbopackIgnore: true*/ filepath);
        deleted++;
        console.info(`[backup] deleted old backup: ${file}`);
      }
    } catch {
      // Skip files that disappear or become inaccessible during cleanup.
    }
  }

  return deleted;
}

/**
 * List completed backup files for the admin maintenance panel.
 */
export async function listBackups(): Promise<
  Array<{
    filename: string;
    sizeBytes: number;
    createdAt: Date;
  }>
> {
  if (!existsSync(/*turbopackIgnore: true*/ BACKUP_DIR)) return [];

  const files = readdirSync(/*turbopackIgnore: true*/ BACKUP_DIR);
  return files
    .filter((file) => file.startsWith("backup-") && file.endsWith(".gz"))
    .map((filename) => {
      const filepath = join(/*turbopackIgnore: true*/ BACKUP_DIR, filename);
      const stats = statSync(/*turbopackIgnore: true*/ filepath);
      return {
        filename,
        sizeBytes: stats.size,
        createdAt: stats.mtime,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
