/**
 * GET /api/admin/diagnostics/events — последние события ошибок
 * (опционально по fingerprint) для разбора инцидента (§4.2).
 *
 * ДОСТУП: серверная авторизация ADMIN/SUPER_ADMIN + RLS 0079.
 * Возвращаются ТОЛЬКО уже маскированные поля (запись маскируется при
 * создании — здесь фильтрации не требуется).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { captureServerError } from "@/lib/diagnostics/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const denied = await requireAnyRole(user.userId, ["ADMIN", "SUPER_ADMIN"]);
  if (denied) {
    const payload = (await denied
      .clone()
      .json()
      .catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(payload, { status: denied.status === 401 ? 401 : 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const fingerprint = searchParams.get("fingerprint");
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);

    const pool = getPool();
    const params: unknown[] = [limit];
    let where = "";
    if (fingerprint) {
      params.push(fingerprint);
      where = `WHERE fingerprint = $2`;
    }

    const res = await pool.query(
      `SELECT event_id, occurred_at, environment, app_version, component,
              severity, error_code, message, correlation_id, request_id,
              route, http_status, source, metadata
         FROM public.app_error_events
         ${where}
         ORDER BY occurred_at DESC
         LIMIT $1`,
      params
    );

    return NextResponse.json({ events: res.rows ?? [] });
  } catch (error) {
    captureServerError(error, {
      component: "api",
      route: "/api/admin/diagnostics/events",
      errorCode: "events_list_failed",
    });
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
