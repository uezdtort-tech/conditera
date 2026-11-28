/**
 * GET  /api/maintenance/history — list maintenance logs (backup + cleanup history)
 * POST /api/maintenance/backup  — manually trigger a backup
 * POST /api/maintenance/cleanup — manually trigger a cleanup
 *
 * Admin-only for POST endpoints. GET is available to any authenticated user
 * (but non-admins only see count, not details).
 *
 * Безопасность:
 *   • GET: limit валидируется (1-200, default 50).
 *   • GET: type опциональный фильтр.
 *   • GET: admin видит dbStats и backups, остальные только logs+total.
 *   • POST: требует роль ADMIN/SUPER_ADMIN.
 *   • POST: action — enum (backup/cleanup), иначе 400.
 *   • При сбое backup/cleanup лог сохраняется со status='failed' и errorMessage.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { runFullBackup, listBackups } from "@/lib/backup";
import { runFullCleanup, getDbStats } from "@/lib/cleanup";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface MaintenanceLogRow {
  id: string;
  type: string;
  status: string;
  triggeredBy: string | null;
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  backupPath: string | null;
  backupSizeBytes: number | null;
  tablesCount: number | null;
  recordsAffected: number | null;
  errorMessage: string | null;
  details: unknown;
}

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
const ACTIONS = ["backup", "cleanup"] as const;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function parsePositiveInt(value: string | null, defaultValue: number, max: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1) return defaultValue;
  return Math.min(num, max);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    const isAdmin = user.roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));

    const { searchParams } = new URL(req.url);
    const limit = parsePositiveInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const type = searchParams.get("type");

    // Build parallel queries
    let logsQuery = supabaseAdmin
      .from("maintenance_logs")
      .select("*")
      .order("createdAt", { ascending: false })
      .limit(limit);
    let countQuery = supabaseAdmin
      .from("maintenance_logs")
      .select("*", { count: "exact", head: true });

    if (type) {
      logsQuery = logsQuery.eq("type", type);
      countQuery = countQuery.eq("type", type);
    }

    const [logsResult, countResult] = await Promise.all([
      isAdmin
        ? logsQuery
        : Promise.resolve({ data: [] as MaintenanceLogRow[], error: null }),
      countQuery,
    ]);

    if (logsResult.error) {
      console.error("[maintenance/history] logs query failed:", logsResult.error.message);
    }
    if (countResult.error) {
      console.error("[maintenance/history] count failed:", countResult.error.message);
    }

    const logs = (logsResult.data || []) as MaintenanceLogRow[];
    const total = countResult.count || 0;

    // Get DB stats for admin
    let dbStats: { tables: Array<{ name: string; count: number }>; totalRecords: number; dbSizeBytes?: number } | null = null;
    let backups: Array<{ filename: string; sizeBytes: number; createdAt: Date }> | null = null;
    if (isAdmin) {
      try {
        dbStats = await getDbStats();
        backups = await listBackups();
      } catch {
        // non-blocking
      }
    }

    return NextResponse.json({
      logs,
      total,
      dbStats,
      backups: backups ? backups.slice(0, 20) : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    const isAdmin = user.roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
    if (!isAdmin) {
      throw new HttpError(403, "Доступ запрещён");
    }

    const { data: body, error: parseErr } = await safeJsonBody<Record<string, unknown>>(req);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    const actionResult = readEnumField(body, "action", ACTIONS, { required: true });
    if (actionResult.error || !actionResult.value) {
      throw new HttpError(422, actionResult.error || `action должен быть одним из: ${ACTIONS.join(", ")}`);
    }
    const action = actionResult.value;

    // Создаём maintenance_log со status="running"
    const logType = action === "backup" ? "BACKUP_FULL" : "CLEANUP_LOGS";
    const { data: logRow, error: logErr } = await supabaseAdmin
      .from("maintenance_logs")
      .insert({
        type: logType,
        status: "running",
        triggeredBy: user.userId,
        startedAt: new Date().toISOString(),
      })
      .select("id")
      .single() as { data: { id: string } | null; error: SupabaseError | null };

    if (logErr || !logRow) {
      console.error("[maintenance/history] log insert failed:", logErr?.message);
      throw new HttpError(500, "Не удалось создать maintenance_log");
    }

    const logId = logRow.id;

    try {
      if (action === "backup") {
        const result = await runFullBackup();
        if (!result.success) {
          throw new Error(result.errorMessage || "Backup service did not confirm a completed PostgreSQL dump");
        }
        await supabaseAdmin
          .from("maintenance_logs")
          .update({
            status: result.success ? "success" : "failed",
            finishedAt: new Date().toISOString(),
            durationMs: result.durationMs,
            backupPath: result.backupPath,
            backupSizeBytes: result.backupSizeBytes,
            tablesCount: result.tablesCount,
            recordsAffected: result.recordsExported,
            errorMessage: result.errorMessage || null,
          })
          .eq("id", logId);
        return NextResponse.json({ success: true, result, logId });
      }

      if (action === "cleanup") {
        const result = await runFullCleanup();
        await supabaseAdmin
          .from("maintenance_logs")
          .update({
            status: "success",
            finishedAt: new Date().toISOString(),
            durationMs: result.totalDurationMs,
            recordsAffected: result.totalDeleted,
            details: { operations: result.results } as unknown as never,
          })
          .eq("id", logId);
        return NextResponse.json({ success: true, result, logId });
      }

      // Unreachable — action validated by readEnumField
      throw new HttpError(400, "Unknown action");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from("maintenance_logs")
        .update({
          status: "failed",
          finishedAt: new Date().toISOString(),
          errorMessage: errMsg.slice(0, 500),
        })
        .eq("id", logId);

      if (action === "backup") {
        throw new HttpError(500, "Backup failed", errMsg);
      } else {
        throw new HttpError(500, "Cleanup failed", errMsg);
      }
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
