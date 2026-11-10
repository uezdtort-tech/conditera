/**
 * GET /api/admin/diagnostics/metrics — диагностические метрики процесса
 * (DEPLOY-01 §5). ДОСТУП: только серверная авторизация ADMIN/SUPER_ADMIN
 * (как /incidents). ПУБЛИЧНО недоступно: /api/health не раскрывает
 * внутренности (см. MONITORING.md), здесь — привилегированный просмотр.
 *
 * Ответ: процесс (RSS/heap/uptime), система (load/память), диск,
 * канал диагностики (очередь/circuit-breaker/дропы), агрегат событий
 * 1ч/24ч (severity, http 5xx), сводка инцидентов. Плюс честные
 * limitations (RPS/p95 без APM не собираются).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { collectMetricsSnapshot } from "@/lib/diagnostics/metrics";
import { captureServerError } from "@/lib/diagnostics/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(
  request: NextRequest
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }),
    };
  }
  const denied = await requireAnyRole(user.userId, ["ADMIN", "SUPER_ADMIN"]);
  if (denied) {
    const cloned = denied.clone();
    const payload = (await cloned.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: false,
      response: NextResponse.json(payload, {
        status: denied.status === 401 ? 401 : 403,
      }),
    };
  }
  return { ok: true, userId: user.userId };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  try {
    const snapshot = await collectMetricsSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // Метрики не должны 500-ить админку: fail-open с частичным ответом
    captureServerError(error, {
      component: "diagnostics-selftest",
      errorCode: "metrics_collect_failed",
      route: "/api/admin/diagnostics/metrics",
      requestId: request.headers.get("x-request-id") ?? undefined,
      actorId: gate.userId,
    });
    return NextResponse.json(
      { error: "metrics partially unavailable", partial: true },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
