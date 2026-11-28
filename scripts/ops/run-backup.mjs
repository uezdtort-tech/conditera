/**
 * run-backup.mjs — тонкий раннер для backup-verify-restore.mjs.
 * Выполняется ТОЛЬКО через bun (резолвит @/ alias из tsconfig):
 *   bun scripts/ops/run-backup.mjs
 */
import { runFullBackup } from "@/lib/backup";

export async function runBackupToFile() {
  const result = await runFullBackup();
  if (!result.success) {
    console.error("[run-backup] backup failed:", result.errorMessage);
    return null;
  }
  console.log(
    `[run-backup] ok: ${result.backupPath}; manifest=${result.manifestPath || "not-created"} (${result.tablesCount} tables, ${result.recordsExported} records)`
  );
  return result.backupPath;
}
