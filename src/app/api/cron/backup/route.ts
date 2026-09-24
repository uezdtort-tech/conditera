/**
 * GET /api/cron/backup — run full database backup (cron-triggered)
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 * Schedule: daily at 03:00 (recommended)
 *
 * Создаёт gzip-бэкап БД, записывает в maintenance_logs,
 * удаляет бэкапы старше 30 дней.
 *
 * Соответствует таблицам:
 *  - maintenance_logs (для лога операции)
 *  - через @/lib/backup: runFullBackup + cleanupOldBackups
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";
import { runFullBackup, cleanupOldBackups } from "@/lib/backup";

export const runtime = "nodejs";

/**
 * GET /api/cron/backup — запустить полный бэкап БД.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Создать "running" log entry
  const { data: log, error: createErr } = await supabaseAdmin
    .from("maintenance_logs")
    .insert({
      type: "BACKUP_FULL",
      status: "running",
      triggered_by: "cron",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (createErr || !log) {
    console.error("[cron/backup] failed to create log:", createErr?.message);
    return NextResponse.json(
      { error: "Failed to create maintenance log", details: createErr?.message },
      { status: 500 }
    );
  }

  try {
    const result = await runFullBackup();
    const oldDeleted = await cleanupOldBackups();

    // Обновить лог с результатом
    const { error: updateErr } = await supabaseAdmin
      .from("maintenance_logs")
      .update({
        status: result.success ? "success" : "failed",
        finished_at: new Date().toISOString(),
        duration_ms: result.durationMs,
        backup_path: result.backupPath,
        backup_size_bytes: result.backupSizeBytes,
        tables_count: result.tablesCount,
        records_affected: result.recordsExported,
        details: {
          oldBackupsDeleted: oldDeleted,
          backupPath: result.backupPath,
          backupSizeBytes: result.backupSizeBytes,
          tablesCount: result.tablesCount,
          recordsExported: result.recordsExported,
          durationMs: result.durationMs,
        },
        error_message: result.errorMessage || null,
      })
      .eq("id", log.id);

    if (updateErr) {
      console.warn("[cron/backup] log update error (non-fatal):", updateErr.message);
    }

    return NextResponse.json({
      success: result.success,
      backupPath: result.backupPath,
      backupSizeBytes: result.backupSizeBytes,
      tablesCount: result.tablesCount,
      recordsExported: result.recordsExported,
      durationMs: result.durationMs,
      oldBackupsDeleted: oldDeleted,
      logId: log.id,
    });
  } catch (error: any) {
    // Обновить лог как failed
    await supabaseAdmin
      .from("maintenance_logs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: error?.message ?? "Unknown error",
      })
      .eq("id", log.id);

    return NextResponse.json(
      { error: "Backup failed", detail: error?.message },
      { status: 500 }
    );
  }
}
