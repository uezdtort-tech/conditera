/**
 * GET /api/ops/tasks — очередь задач «Требуют действия» (Task 2-a).
 *
 * Query:
 *   - status:   open | resolved | dismissed | all (default open);
 *   - severity: critical | important | info (опционально);
 *   - limit:    1..100 (default 50);
 *   - offset:   >= 0 (default 0);
 *   - refresh:  1 → принудительный скан rule engine (иначе throttle 45с).
 *
 * Auth: любой авторизованный; видимость — visibleTaskFilter по ролям
 * (ADMIN/SUPER_ADMIN — всё; MODERATOR — ADMIN/MODERATOR/общие/свои;
 * остальные — только assignee_id = user.id).
 *
 * Ответ: { tasks, counts: {critical, important, info}, scannedAt }.
 * tasks — строки ops_tasks (snake_case); counts — открытые задачи по severity.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { materializeOpsTasks, type OpsScanStats } from "@/lib/ops/rules";
import { visibleTaskFilter } from "@/lib/ops/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["open", "resolved", "dismissed", "all"]);
const SEVERITIES = new Set(["critical", "important", "info"]);

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
      { status: 401 }
    );
  }

  console.log("[2a-marker] GET tasks route v2");
  const sp = request.nextUrl.searchParams;
  const statusParam = sp.get("status") ?? "open";
  const status = STATUSES.has(statusParam) ? statusParam : "open";
  const severityParam = sp.get("severity");
  const severity =
    severityParam && SEVERITIES.has(severityParam) ? severityParam : null;

  const rawLimit = Number.parseInt(sp.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
  const rawOffset = Number.parseInt(sp.get("offset") ?? "0", 10);
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
  const force = sp.get("refresh") === "1";

  // Rule engine (throttle 45с внутри; refresh=1 — force). Падение движка
  // не ломает выдачу очереди.
  let stats: OpsScanStats | null = null;
  try {
    stats = await materializeOpsTasks(force);
  } catch (err) {
    console.warn(
      "[ops/tasks] materializeOpsTasks failed (queue served as-is):",
      err instanceof Error ? err.message : err
    );
  }

  const pool = getPool();
  const vis = visibleTaskFilter(user, 1);
  const params: unknown[] = [...vis.params];

  let where = vis.clause === "TRUE" ? "TRUE" : vis.clause;
  if (status !== "all") {
    params.push(status);
    where += ` AND t.status = $${params.length}`;
  }
  if (severity) {
    params.push(severity);
    where += ` AND t.severity = $${params.length}`;
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `SELECT t.id, t.dedup_key, t.type, t.severity, t.title, t.description,
            t.entity_type, t.entity_id, t.assignee_role, t.assignee_id,
            t.payload, t.action_label, t.action_url, t.status, t.source,
            t.due_at, t.resolved_by, t.resolved_at, t.resolve_comment,
            t.created_at, t.updated_at
     FROM public.ops_tasks t
     WHERE ${where}
     ORDER BY CASE t.severity WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
              t.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  const countsRows = await pool.query<{ severity: string; c: number }>(
    `SELECT t.severity, count(*)::int AS c
     FROM public.ops_tasks t
     WHERE t.status = 'open' AND ${vis.clause === "TRUE" ? "TRUE" : vis.clause}
     GROUP BY t.severity`,
    vis.params
  );
  const counts: Record<string, number> = { critical: 0, important: 0, info: 0 };
  for (const row of countsRows.rows) {
    counts[row.severity] = row.c;
  }

  return NextResponse.json({ tasks: rows, counts, scannedAt: stats?.scannedAt ?? null });
}
