/**
 * GET /api/cron/cleanup — run full database cleanup (cron-triggered)
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 * Schedule: daily at 04:00 (recommended, after backup)
 *
 * Runs all cleanup operations via runFullCleanup() from @/lib/cleanup:
 *   - Delete old maintenance logs (>90 days)
 *   - Delete read notifications (>90 days)
 *   - Delete abandoned carts (>30 days, no recent orders)
 *   - Delete expired semaphores (>7 days, unverified)
 *   - Delete old stock movements (>180 days)
 *   - Delete old organization verifications (>365 days, keep latest per INN)
 *
 * Соответствует таблицам:
 *  - maintenance_logs (для записи лога)
 *  - все таблицы из @/lib/cleanup (несколько)
 *
 * Возвращает JSON с суммарным количеством удалённых записей и логом операций.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";
import { runFullCleanup, type CleanupResult } from "@/lib/cleanup";

export const runtime = "nodejs";

interface FullCleanupResult {
  results: CleanupResult[];
  totalDeleted: number;
  totalDurationMs: number;
}

/**
 * GET /api/cron/cleanup — запуск полной очистки БД.
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
      type: "CLEANUP_LOGS",
      status: "running",
      triggeredBy: "cron",
      startedAt: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (createErr || !log) {
    console.error("[cron/cleanup] failed to create maintenance log:", createErr?.message);
    return NextResponse.json(
      { error: "Failed to create maintenance log", details: createErr?.message },
      { status: 500 }
    );
  }

  try {
    const result: FullCleanupResult = await runFullCleanup();

    // Обновить лог как успешный
    const { error: updateErr } = await supabaseAdmin
      .from("maintenance_logs")
      .update({
        status: "success",
        finishedAt: new Date().toISOString(),
        durationMs: result.totalDurationMs,
        recordsAffected: result.totalDeleted,
        details: {
          operations: result.results.map((r) => ({
            type: r.type,
            success: r.success,
            recordsAffected: r.recordsAffected,
            durationMs: r.durationMs,
            details: r.details,
            errorMessage: r.errorMessage,
          })),
        },
      })
      .eq("id", log.id);

    if (updateErr) {
      console.warn("[cron/cleanup] log update error (non-fatal):", updateErr.message);
    }

    return NextResponse.json({
      success: true,
      totalDeleted: result.totalDeleted,
      durationMs: result.totalDurationMs,
      operations: result.results.map((r) => ({
        type: r.type,
        success: r.success,
        recordsAffected: r.recordsAffected,
        durationMs: r.durationMs,
        errorMessage: r.errorMessage,
      })),
      logId: log.id,
    });
  } catch (error: any) {
    // Обновить лог как failed
    await supabaseAdmin
      .from("maintenance_logs")
      .update({
        status: "failed",
        finishedAt: new Date().toISOString(),
        error_message: error?.message ?? "Unknown error",
      })
      .eq("id", log.id);

    return NextResponse.json(
      { error: "Cleanup failed", detail: error?.message },
      { status: 500 }
    );
  }
}
