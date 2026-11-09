/**
 * GET  /api/admin/diagnostics/incidents — список инцидентов (§4.2):
 *   фильтры status/priority/component, поиск по ID/fingerprint/title,
 *   пагинация. Сводка: ?summary=1.
 * PATCH /api/admin/diagnostics/incidents — смена статуса (§4):
 *   валидация переходов сервером, история пишется app-side.
 *
 * ДОСТУП (§4.2): только серверная авторизация ADMIN/SUPER_ADMIN
 * (requireAnyRole → user_roles через service-role). Клиентские проверки
 * не являются механизмом безопасности. Дополнительно RLS 0079.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import {
  listIncidents,
  getIncidentHistory,
  getIncidentSummary,
  transitionIncident,
  IncidentStateError,
  type IncidentStatus,
} from "@/lib/diagnostics/incidents";
import { captureServerError } from "@/lib/diagnostics/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = [
  "NEW", "TRIAGED", "IN_PROGRESS", "FIXED", "VERIFIED", "CLOSED", "REOPENED", "IGNORED",
] as const;

async function requireAdmin(request: NextRequest): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  }
  const denied = await requireAnyRole(user.userId, ["ADMIN", "SUPER_ADMIN"]);
  if (denied) {
    // Серверный гейт вернул Response — конвертируем в NextResponse с тем же телом
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
    const { searchParams } = new URL(request.url);

    // Сводка для дашборда
    if (searchParams.get("summary") === "1") {
      const summary = await getIncidentSummary();
      return NextResponse.json({ summary });
    }

    // История конкретного инцидента
    const incidentId = searchParams.get("incidentId");
    if (incidentId) {
      const history = await getIncidentHistory(incidentId);
      return NextResponse.json({ history });
    }

    const status = searchParams.get("status") || undefined;
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return NextResponse.json({ error: `status должен быть одним из: ${STATUSES.join(",")}` }, { status: 400 });
    }
    const priority = searchParams.get("priority") || undefined;
    if (priority && !["P0", "P1", "P2", "P3"].includes(priority)) {
      return NextResponse.json({ error: "priority должен быть P0|P1|P2|P3" }, { status: 400 });
    }

    const result = await listIncidents({
      status,
      priority,
      component: searchParams.get("component") || undefined,
      search: searchParams.get("q") || undefined,
      limit: Number(searchParams.get("limit")) || 50,
      offset: Number(searchParams.get("offset")) || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    captureServerError(error, {
      component: "api",
      route: "/api/admin/diagnostics/incidents",
      errorCode: "incidents_list_failed",
    });
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

interface PatchBody {
  incidentId?: unknown;
  toStatus?: unknown;
  note?: unknown;
  fixCommit?: unknown;
  ignoreReason?: unknown;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  try {
    let body: PatchBody;
    try {
      body = (await request.json()) as PatchBody;
    } catch {
      return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
    }

    const incidentId = typeof body.incidentId === "string" ? body.incidentId : null;
    const toStatus = typeof body.toStatus === "string" ? (body.toStatus as IncidentStatus) : null;
    if (!incidentId || !toStatus || !STATUSES.includes(toStatus)) {
      return NextResponse.json(
        { error: "incidentId и toStatus (допустимый статус) обязательны" },
        { status: 400 }
      );
    }

    // Пред-валидация перехода (client-friendly 409 до обращения к БД)
    // Точный from-статус проверяется в transitionIncident.
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : undefined;
    const fixCommit =
      typeof body.fixCommit === "string" ? body.fixCommit.slice(0, 40) : undefined;
    const ignoreReason =
      typeof body.ignoreReason === "string" ? body.ignoreReason.slice(0, 500) : undefined;

    if (toStatus === "IGNORED" && !ignoreReason?.trim()) {
      return NextResponse.json(
        { error: "IGNORED требует обязательную причину (ignoreReason)" },
        { status: 400 }
      );
    }

    const updated = await transitionIncident({
      incidentId,
      toStatus,
      actorId: gate.userId,
      note,
      fixCommit,
      ignoreReason,
    });
    return NextResponse.json({ incident: updated });
  } catch (error) {
    if (error instanceof IncidentStateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    captureServerError(error, {
      component: "api",
      route: "/api/admin/diagnostics/incidents",
      errorCode: "incidents_patch_failed",
    });
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
