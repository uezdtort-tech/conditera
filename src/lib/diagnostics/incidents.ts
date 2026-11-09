/**
 * incidents.ts — серверная логика реестра инцидентов (DEPLOY-01 §4).
 *
 * ВАЖНО (§4.2): все функции предназначены для вызова ИЗ API-роутов после
 * серверной авторизации (requireAnyRole ADMIN/SUPER_ADMIN). Клиентские
 * проверки (скрытие кнопки/роль в токене) не являются механизмом
 * безопасности — доступ контролируется здесь + RLS (0079).
 *
 * Статусная машина (§4):
 *   NEW → TRIAGED → IN_PROGRESS → FIXED → VERIFIED → CLOSED
 *   + REOPENED (рецидив после CLOSED/VERIFIED — из event-store),
 *   + IGNORED (с обязательной причиной, автором, временем).
 */

import { getPool } from "@/lib/postgrest/pool";

export type IncidentStatus =
  | "NEW"
  | "TRIAGED"
  | "IN_PROGRESS"
  | "FIXED"
  | "VERIFIED"
  | "CLOSED"
  | "REOPENED"
  | "IGNORED";

/** Разрешённые переходы статусной машины (§4). */
const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  NEW: ["TRIAGED", "IN_PROGRESS", "IGNORED", "CLOSED"],
  TRIAGED: ["IN_PROGRESS", "IGNORED", "CLOSED"],
  IN_PROGRESS: ["FIXED", "IGNORED", "CLOSED"],
  FIXED: ["VERIFIED", "CLOSED"],
  VERIFIED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["TRIAGED", "IN_PROGRESS", "FIXED", "IGNORED", "CLOSED"],
  IGNORED: ["REOPENED"],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

export class IncidentStateError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "IncidentStateError";
    this.status = status;
  }
}

export interface IncidentFilters {
  status?: string;
  priority?: string;
  component?: string;
  search?: string; // по id / fingerprint / title
  limit?: number;
  offset?: number;
}

export interface IncidentListResult {
  items: IncidentRecord[];
  total: number;
}

export interface IncidentRecord {
  id: string;
  fingerprint: string;
  title: string;
  component: string;
  priority: string;
  status: string;
  severity: string;
  error_code: string | null;
  last_route: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  first_version: string | null;
  last_version: string | null;
  resolved_at: string | null;
  resolved_version: string | null;
  fix_commit: string | null;
  ignore_reason: string | null;
  notified_at: string | null;
}

/** Список с фильтрацией + поиск по ID/fingerprint (§4.2). */
export async function listIncidents(filters: IncidentFilters): Promise<IncidentListResult> {
  const pool = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    conditions.push(`priority = $${params.length}`);
  }
  if (filters.component) {
    params.push(filters.component);
    conditions.push(`component = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search.trim().toLowerCase()}%`);
    const i = params.length;
    conditions.push(
      `(lower(fingerprint) LIKE $${i} OR lower(title) LIKE $${i} OR id::text LIKE $${i})`
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const rows = await pool.query(
    `SELECT id, fingerprint, title, component, priority, status, severity,
            error_code, last_route, occurrence_count,
            first_seen_at, last_seen_at, first_version, last_version,
            resolved_at, resolved_version, fix_commit, ignore_reason, notified_at
       FROM public.app_incidents
       ${where}
       ORDER BY last_seen_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  const totalRows = await pool.query(
    `SELECT count(*)::int AS total FROM public.app_incidents ${where}`,
    params.slice(0, params.length - 2)
  );

  const items = (rows.rows ?? []) as unknown as IncidentRecord[];
  const total =
    ((totalRows.rows?.[0] as { total?: number } | undefined)?.total as number) || 0;
  return { items, total };
}

/** История статусов конкретного инцидента (§4.2). */
export async function getIncidentHistory(incidentId: string): Promise<HistoryRow[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT h.id, h.incident_id, h.from_status, h.to_status, h.actor_id, h.note, h.created_at,
            p.full_name AS actor_name
       FROM public.app_incident_history h
       LEFT JOIN public.profiles p ON p.id = h.actor_id
      WHERE h.incident_id = $1
      ORDER BY h.created_at DESC
      LIMIT 100`,
    [incidentId]
  );
  return (res.rows ?? []) as unknown as HistoryRow[];
}

export interface HistoryRow {
  id: string;
  incident_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

export interface TransitionInput {
  incidentId: string;
  toStatus: IncidentStatus;
  actorId: string;
  note?: string;
  fixCommit?: string;
  ignoreReason?: string;
}

/**
 * Смена статуса с серверной валидацией перехода + запись истории (§4, §11).
 * Бросает IncidentStateError (409) при недопустимом переходе,
 * NotFoundError (404) при отсутствии инцидента.
 */
export async function transitionIncident(input: TransitionInput): Promise<IncidentRecord> {
  const pool = getPool();

  const current = await pool.query(
    `SELECT id, status, fingerprint, title, component, priority, severity,
            error_code, last_route, occurrence_count, first_seen_at, last_seen_at,
            first_version, last_version, resolved_at, resolved_version, fix_commit,
            ignore_reason, notified_at
       FROM public.app_incidents WHERE id = $1`,
    [input.incidentId]
  );
  const row = current.rows?.[0] as (IncidentRecord & { status: IncidentStatus }) | undefined;
  if (!row) {
    throw new IncidentStateError("Инцидент не найден", 404);
  }

  if (!canTransition(row.status, input.toStatus)) {
    throw new IncidentStateError(
      `Недопустимый переход ${row.status} → ${input.toStatus}`
    );
  }

  if (input.toStatus === "IGNORED" && !input.ignoreReason?.trim()) {
    throw new IncidentStateError("IGNORED требует обязательную причину", 400);
  }

  const now = new Date();
  const isResolution =
    input.toStatus === "FIXED" || input.toStatus === "VERIFIED" || input.toStatus === "CLOSED";

  await pool.query(
    `UPDATE public.app_incidents SET
       status = $2,
       resolved_at = CASE WHEN $2 IN ('FIXED','VERIFIED','CLOSED') THEN $3 ELSE resolved_at END,
       resolved_version = CASE WHEN $2 IN ('FIXED','VERIFIED','CLOSED') THEN $4 ELSE resolved_version END,
       fix_commit = COALESCE($5, fix_commit),
       ignore_reason = CASE WHEN $2 = 'IGNORED' THEN $6 ELSE ignore_reason END,
       ignore_actor_id = CASE WHEN $2 = 'IGNORED' THEN $7 ELSE ignore_actor_id END,
       updated_at = $3
     WHERE id = $1`,
    [
      input.incidentId,
      input.toStatus,
      now,
      process.env.APP_VERSION || "2.0.0-dev",
      input.fixCommit || null,
      input.ignoreReason || null,
      input.actorId,
    ]
  );

  await pool.query(
    `INSERT INTO public.app_incident_history
       (incident_id, from_status, to_status, actor_id, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.incidentId, row.status, input.toStatus, input.actorId, input.note || null]
  );

  return {
    ...row,
    status: input.toStatus,
    resolved_at: isResolution ? now.toISOString() : row.resolved_at,
  };
}

/** Сводка для дашборда/отчёта (§12): counts по статусам и приоритетам. */
export interface IncidentSummary {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  openTotal: number;
  last24h: number;
}

export async function getIncidentSummary(): Promise<IncidentSummary> {
  const pool = getPool();
  const byStatus = await pool.query(
    `SELECT status, count(*)::int AS n FROM public.app_incidents GROUP BY status`
  );
  const byPriority = await pool.query(
    `SELECT priority, count(*)::int AS n FROM public.app_incidents GROUP BY priority`
  );
  const last24 = await pool.query(
    `SELECT count(*)::int AS n FROM public.app_incidents WHERE last_seen_at > now() - interval '24 hours'`
  );

  const toMap = (rows: Array<Record<string, unknown>>): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const r of rows || []) map[String(r[Object.keys(r)[0]])] = Number(r.n);
    return map;
  };

  const statusMap = toMap(byStatus.rows ?? []);
  const priorityMap = toMap(byPriority.rows ?? []);
  const openTotal =
    (statusMap.NEW || 0) +
    (statusMap.TRIAGED || 0) +
    (statusMap.IN_PROGRESS || 0) +
    (statusMap.REOPENED || 0);
  const last24h = Number((last24.rows?.[0] as { n?: number } | undefined)?.n || 0);

  return { byStatus: statusMap, byPriority: priorityMap, openTotal, last24h };
}
