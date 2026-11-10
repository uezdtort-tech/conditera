/**
 * GET /api/cron/diagnostics-cleanup — ретеншн app_error_events
 * (DEPLOY-01 §5/§12: журнал ошибок не должен расти бесконечно).
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var) — как /api/cron/backup.
 * Политика:
 *   • raw-события старше DIAGNOSTICS_RETENTION_DAYS (по умолчанию 90) — удаляются;
 *   • инциденты (app_incidents) и история (app_incident_history) — РЕЕСТР,
 *     НЕ удаляются (владелец закрывает инциденты через админ-панель §4);
 *   • факт операции пишется в maintenance_logs (тип DIAGNOSTICS_CLEANUP).
 *
 * Расписание: ежедневно после бэкапа (см. docs/operations/MONITORING.md §5).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";
import { getPool } from "@/lib/postgrest/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3650;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = Number(process.env.DIAGNOSTICS_RETENTION_DAYS);
  const retentionDays = Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), MAX_RETENTION_DAYS)
    : DEFAULT_RETENTION_DAYS;

  try {
    const pool = getPool();
    const res = await pool.query(
      `DELETE FROM public.app_error_events
       WHERE occurred_at < now() - ($1 || ' days')::interval`,
      [String(retentionDays)]
    );
    const deleted = res.rowCount ?? 0;

    // Лог операции (неблокирующая честная запись; сбой лога не ломает очистку)
    const { error: logErr } = await supabaseAdmin.from("maintenance_logs").insert({
      type: "DIAGNOSTICS_CLEANUP",
      status: "success",
      triggeredBy: "cron",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      details: { deletedEvents: deleted, retentionDays },
    });
    if (logErr) {
      console.warn("[diagnostics-cleanup] maintenance_logs write failed:", logErr.message);
    }

    return NextResponse.json({
      ok: true,
      deletedEvents: deleted,
      retentionDays,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin
      .from("maintenance_logs")
      .insert({
        type: "DIAGNOSTICS_CLEANUP",
        status: "failed",
        triggeredBy: "cron",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        details: { error: message.slice(0, 500), retentionDays },
      })
      .then(
        () => undefined,
        () => undefined
      );
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
