/**
 * POST /api/ops/tasks/[taskId] — resolve/dismiss задачи очереди (Task 2-a).
 *
 * Body: { action: "resolve" | "dismiss", comment?: string }
 * CAS по статусу: только open → resolved|dismissed (иначе 409 NOT_OPEN).
 * Права: видящий задачу по visibleTaskFilter (ADMIN — всё; MODERATOR — свои;
 * CONFECTIONER — лично назначенные). Не видит → 404.
 *
 * Ответ: { task } — обновлённая строка ops_tasks (snake_case).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { visibleTaskFilter } from "@/lib/ops/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ taskId: string }> }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    const { taskId } = await ctx.params;

    let body: { action?: unknown; comment?: unknown } | null = null;
    try {
      body = (await request.json()) as { action?: unknown; comment?: unknown };
    } catch {
      body = null;
    }
    const action = body?.action;
    if (action !== "resolve" && action !== "dismiss") {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "action должен быть 'resolve' или 'dismiss'" },
        { status: 422 }
      );
    }
    const comment =
      typeof body?.comment === "string" ? body.comment.trim().slice(0, 500) || null : null;
    const nextStatus = action === "resolve" ? "resolved" : "dismissed";

    const pool = getPool();
    // Параметры видимости дописываются В ХВОСТ: у админа clause=TRUE (0 доп.
    // параметров), у остальных clause ссылается на $5 (user.id). Явные cast-ы
    // обязательны: comment может быть NULL → 42P18.
    const vis = visibleTaskFilter(user, 5);
    const params: unknown[] = [nextStatus, user.id, comment, taskId, ...vis.params];

    const { rows } = await pool.query(
      `UPDATE public.ops_tasks t
       SET status = $1::text, resolved_by = $2::uuid, resolved_at = now(),
           resolve_comment = $3::text, updated_at = now()
       WHERE t.id = $4::uuid AND t.status = 'open' AND ${vis.clause}
       RETURNING t.id, t.dedup_key, t.type, t.severity, t.title, t.description,
                 t.entity_type, t.entity_id, t.assignee_role, t.assignee_id,
                 t.payload, t.action_label, t.action_url, t.status, t.source,
                 t.due_at, t.resolved_by, t.resolved_at, t.resolve_comment,
                 t.created_at, t.updated_at`,
      params
    );

    if (rows.length === 0) {
      // Различаем 404 (не видит/нет) и 409 (видит, но уже не open)
      const visEx = visibleTaskFilter(user, 2);
      const ex = await pool.query(
        `SELECT t.status FROM public.ops_tasks t
         WHERE t.id = $1::uuid AND ${visEx.clause}`,
        [taskId, ...visEx.params]
      );
      if (ex.rowCount === 0) {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "Задача не найдена или недоступна" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        {
          error: "NOT_OPEN",
          message: `Задача уже в статусе «${ex.rows[0].status}» — повторная обработка не требуется`,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ task: rows[0] });
  } catch (error) {
    console.error("[ops/tasks/[taskId]] POST error:", error);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
