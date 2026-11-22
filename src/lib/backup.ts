/**
 * Полный PostgreSQL + file-storage backup.
 *
 * Production archive consists of:
 *  - pg_dump of the complete database;
 *  - product-media filesystem volume;
 *  - Supabase Storage volume;
 *  - JSON manifest with SHA-256 checksums.
 *
 * Every component is streamed to a temporary file and atomically renamed.
 * A partial backup is removed and is never reported as successful.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";

const BACKUP_DIR = process.env.BACKUP_DIR || join(process.cwd(), "backups");
const PRODUCT_MEDIA_ROOT =
  process.env.PRODUCT_MEDIA_ROOT || join(process.cwd(), "storage");
const SUPABASE_STORAGE_BACKUP_ROOT = process.env.SUPABASE_STORAGE_BACKUP_ROOT || "";
const BACKUP_RETENTION_DAYS = 30;
const COMMAND_TIMEOUT_MS = 300_000;

interface BackupArtifact {
  path: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
}

interface BackupManifest {
  version: 1;
  createdAt: string;
  database: BackupArtifact;
  productMedia: BackupArtifact;
  supabaseStorage: BackupArtifact | null;
  tablesCount: number;
  backupSizeBytes: number;
}

interface BackupResult {
  success: boolean;
  backupPath: string;
  databaseBackupPath: string;
  productMediaBackupPath: string;
  supabaseStorageBackupPath: string | null;
  backupSizeBytes: number;
  tablesCount: number;
  recordsExported: number;
  durationMs: number;
  errorMessage?: string;
}

function parsePgDumpConnection(databaseUrl: string): {
  connectionString: string;
  password: string;
} {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Backup connection URL must use postgres:// or postgresql://");
  }

  const password = decodeURIComponent(parsed.password);
  parsed.password = "";

  // Prisma/pooler-only options are not valid libpq connection parameters.
  for (const key of ["schema", "pgbouncer", "connection_limit", "pool_timeout"]) {
    parsed.searchParams.delete(key);
  }

  return { connectionString: parsed.toString(), password };
}

async function streamCommandToGzip(
  command: string,
  args: string[],
  targetPath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const tempPath = `${targetPath}.tmp`;
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (!child.stdout || !child.stderr) {
    child.kill("SIGTERM");
    throw new Error(`Unable to open ${command} output streams`);
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
        reject(new Error(`${command} exceeded ${COMMAND_TIMEOUT_MS}ms timeout`));
      } else if (code !== 0) {
        reject(
          new Error(
            `${command} exited with code ${code ?? "unknown"} signal ${signal ?? "none"}: ${stderr || "no stderr"}`
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
    createWriteStream(/*turbopackIgnore: true*/ tempPath, {
      flags: "wx",
      mode: 0o600,
    })
  );
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, COMMAND_TIMEOUT_MS);

  try {
    await Promise.all([outputResult, processResult]);
    renameSync(/*turbopackIgnore: true*/ tempPath, /*turbopackIgnore: true*/ targetPath);
  } catch (error) {
    child.kill("SIGTERM");
    await Promise.allSettled([outputResult, processResult]);
    try {
      unlinkSync(/*turbopackIgnore: true*/ tempPath);
    } catch {
      // Temporary output may not have been created.
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (statSync(/*turbopackIgnore: true*/ targetPath).size <= 0) {
    try {
      unlinkSync(/*turbopackIgnore: true*/ targetPath);
    } catch {
      // Preserve the original empty-archive error.
    }
    throw new Error(`${command} produced an empty archive`);
  }
}

async function sha256File(filepath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(/*turbopackIgnore: true*/ filepath);
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function makeArtifact(
  filepath: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<BackupArtifact> {
  await streamCommandToGzip(command, args, filepath, env);
  const stats = statSync(/*turbopackIgnore: true*/ filepath);
  return {
    path: filepath,
    filename: filepath.split(/[\\/]/).pop() || filepath,
    sizeBytes: stats.size,
    sha256: await sha256File(filepath),
  };
}

async function pgDumpBackup(
  databaseUrl: string,
  filename: string
): Promise<{ artifact: BackupArtifact; tablesCount: number }> {
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
    if (tablesCount < 1) {
      throw new Error("Backup database has no user tables; refusing to create an empty archive");
    }
  } finally {
    await db.end().catch(() => undefined);
  }

  const filepath = join(/*turbopackIgnore: true*/ BACKUP_DIR, filename);
  const artifact = await makeArtifact(
    filepath,
    "pg_dump",
    [connectionString, "--no-owner", "--no-privileges"],
    {
      ...process.env,
      ...(password ? { PGPASSWORD: password } : {}),
      PGAPPNAME: "conditera-production-backup",
    }
  );
  return { artifact, tablesCount };
}

async function tarDirectory(
  sourceDirectory: string,
  filename: string
): Promise<BackupArtifact> {
  if (!existsSync(/*turbopackIgnore: true*/ sourceDirectory)) {
    throw new Error(`Required backup storage directory does not exist: ${sourceDirectory}`);
  }
  if (!statSync(/*turbopackIgnore: true*/ sourceDirectory).isDirectory()) {
    throw new Error(`Backup storage path is not a directory: ${sourceDirectory}`);
  }

  const filepath = join(/*turbopackIgnore: true*/ BACKUP_DIR, filename);
  return makeArtifact(filepath, "tar", ["-cf", "-", "-C", sourceDirectory, "."]);
}

/**
 * Create a consistent database + file-storage backup.
 * In production, both the product-media volume and Supabase Storage volume
 * are mandatory; a database-only archive is not considered a full backup.
 */
export async function runFullBackup(): Promise<BackupResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `backup-${timestamp}`;
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
  if (isProd && new URL(databaseUrl).username !== "conditera_backup") {
    throw new Error("Production BACKUP_DATABASE_URL must use the dedicated read-only conditera_backup role");
  }
  if (isProd && !SUPABASE_STORAGE_BACKUP_ROOT) {
    throw new Error("SUPABASE_STORAGE_BACKUP_ROOT is required for complete production backups");
  }

  if (!existsSync(/*turbopackIgnore: true*/ BACKUP_DIR)) {
    mkdirSync(/*turbopackIgnore: true*/ BACKUP_DIR, { recursive: true, mode: 0o700 });
  }
  chmodSync(/*turbopackIgnore: true*/ BACKUP_DIR, 0o700);

  const artifacts: BackupArtifact[] = [];
  let manifestTempPath: string | null = null;
  try {
    const { artifact: database, tablesCount } = await pgDumpBackup(
      databaseUrl,
      `${prefix}.sql.gz`
    );
    artifacts.push(database);

    const productMedia = await tarDirectory(
      PRODUCT_MEDIA_ROOT,
      `${prefix}.product-media.tar.gz`
    );
    artifacts.push(productMedia);

    const supabaseStorage = SUPABASE_STORAGE_BACKUP_ROOT
      ? await tarDirectory(
          SUPABASE_STORAGE_BACKUP_ROOT,
          `${prefix}.supabase-storage.tar.gz`
        )
      : null;
    if (supabaseStorage) artifacts.push(supabaseStorage);

    const backupSizeBytes = artifacts.reduce((sum, item) => sum + item.sizeBytes, 0);
    const manifest: BackupManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      database,
      productMedia,
      supabaseStorage,
      tablesCount,
      backupSizeBytes,
    };
    const manifestPath = join(/*turbopackIgnore: true*/ BACKUP_DIR, `${prefix}.json`);
    manifestTempPath = `${manifestPath}.tmp`;
    writeFileSync(
      /*turbopackIgnore: true*/ manifestTempPath,
      JSON.stringify(manifest, null, 2),
      { flag: "wx", mode: 0o600 }
    );
    renameSync(
      /*turbopackIgnore: true*/ manifestTemp,
      /*turbopackIgnore: true*/ manifestPath
    );

    const durationMs = Date.now() - startTime;
    console.info(
      `[backup] ✓ complete: ${prefix} (${(backupSizeBytes / 1024 / 1024).toFixed(2)} MB, ${tablesCount} tables, ${artifacts.length} components, ${durationMs}ms)`
    );

    return {
      success: true,
      backupPath: manifestPath,
      databaseBackupPath: database.path,
      productMediaBackupPath: productMedia.path,
      supabaseStorageBackupPath: supabaseStorage?.path || null,
      backupSizeBytes,
      tablesCount,
      recordsExported: 0,
      durationMs,
    };
  } catch (error) {
    if (manifestTempPath) {
      try {
        unlinkSync(/*turbopackIgnore: true*/ manifestTempPath);
      } catch {
        // Ignore a missing partial manifest.
      }
    }
    for (const artifact of artifacts) {
      try {
        unlinkSync(/*turbopackIgnore: true*/ artifact.path);
      } catch {
        // Continue removing other partial components.
      }
    }
    throw error;
  }
}

/**
 * Delete backup sets older than BACKUP_RETENTION_DAYS.
 * Every manifest and all component archives sharing its prefix are removed.
 */
export async function cleanupOldBackups(): Promise<number> {
  if (!existsSync(/*turbopackIgnore: true*/ BACKUP_DIR)) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_RETENTION_DAYS);

  const files = readdirSync(/*turbopackIgnore: true*/ BACKUP_DIR);
  let deleted = 0;

  for (const manifestName of files.filter(
    (file) => file.startsWith("backup-") && file.endsWith(".json")
  )) {
    const manifestPath = join(/*turbopackIgnore: true*/ BACKUP_DIR, manifestName);
    try {
      const stats = statSync(/*turbopackIgnore: true*/ manifestPath);
      if (!stats.isFile() || stats.mtime >= cutoff) continue;

      const prefix = manifestName.slice(0, -".json".length);
      for (const file of files.filter((candidate) => candidate.startsWith(`${prefix}.`))) {
        try {
          unlinkSync(/*turbopackIgnore: true*/ join(BACKUP_DIR, file));
        } catch {
          // Continue cleanup of the remaining components.
        }
      }
      try {
        unlinkSync(/*turbopackIgnore: true*/ manifestPath);
      } catch {
        // Ignore a concurrently removed manifest.
      }
      deleted++;
      console.info(`[backup] deleted old backup set: ${prefix}`);
    } catch {
      // Skip manifests that disappear or become inaccessible during cleanup.
    }
  }

  return deleted;
}

/**
 * List only complete backup sets (manifest + required component files).
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
  const backups: Array<{ filename: string; sizeBytes: number; createdAt: Date }> = [];
  for (const filename of files.filter(
    (file) => file.startsWith("backup-") && file.endsWith(".json")
  )) {
    const manifestPath = join(/*turbopackIgnore: true*/ BACKUP_DIR, filename);
    try {
      const manifest = JSON.parse(
        readFileSync(/*turbopackIgnore: true*/ manifestPath, "utf8")
      ) as BackupManifest;
      const required = [manifest.database, manifest.productMedia];
      if (manifest.supabaseStorage) required.push(manifest.supabaseStorage);
      const complete = required.every((artifact) => {
        const artifactPath = join(/*turbopackIgnore: true*/ BACKUP_DIR, artifact.filename);
        return existsSync(/*turbopackIgnore: true*/ artifactPath) &&
          statSync(/*turbopackIgnore: true*/ artifactPath).size === artifact.sizeBytes;
      });
      if (!complete) continue;
      const stats = statSync(/*turbopackIgnore: true*/ manifestPath);
      backups.push({
        filename,
        sizeBytes: Number(manifest.backupSizeBytes || 0),
        createdAt: manifest.createdAt ? new Date(manifest.createdAt) : stats.mtime,
      });
    } catch {
      // An incomplete/corrupt backup set is not advertised as restorable.
    }
  }
  return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
