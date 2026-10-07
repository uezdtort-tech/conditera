/**
 * GET /api/orders/[id]/timeline — таймлайн заказа (ТЗ §41).
 *
 * Источник — СУЩЕСТВУЮЩИЙ Event Engine: domain_events (entity=order)
 * + order_status_history (audit-записи переходов). Параллельной истории
 * НЕ создаём.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { loadOrderLite, canViewOrderChecked } from "@/lib/ops/order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TimelineItem {
  at: string;
  type: string;
  title: string;
  source: string;
  payload: Record<string, unknown>;
  kind: "event" | "status";
  actor: string | null;
}

const EVENT_TITLES: Record<string, string> = {
  "order.created": "Заказ создан",
  "order.paid": "Оплата получена",
  "order.accepted": "Заказ принят",
  "order.assigned": "Назначен кондитер",
  "order.reassigned": "Кондитер переназначен",
  "order.reservation_created": "Окно производства закреплено",
  "order.reservation_released": "Окно производства освобождено",
  "order.production_started": "Производство начато",
  "order.production_completed": "Производство завершено",
  "order.ready": "Заказ готов",
  "order.handed_off": "Передача выполнена",
  "order.delivery_started": "Доставка началась",
  "order.delivered": "Доставлено",
  "order.completed": "Заказ завершён",
  "order.cancelled": "Заказ отменён",
  "order.refunded": "Возврат",
  "order.at_risk": "Заказ под риском",
  "order.risk_cleared": "Риск устранён",
  "order.unassigned_escalated": "Эскалация: кондитер не назначен",
  "order.status_changed": "Статус изменён",
  "purchase.draft_created": "Создан черновик закупки",
  "media.uploaded": "Фото готовности загружено",
  "ops.task_created": "Создана операционная задача",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    const order = await loadOrderLite(id);
    if (!order) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Заказ не найден" },
        { status: 404 }
      );
    }
    if (!(await canViewOrderChecked(order, user.id))) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Нет доступа к заказу" },
        { status: 403 }
      );
    }

    const pool = getPool();
    const events = await pool.query<{
      at: Date;
      type: string;
      source: string;
      payload: Record<string, unknown>;
      actor: string | null;
    }>(
      `SELECT occurred_at AS at, type, source, payload, actor_id::text AS actor
       FROM public.domain_events
       WHERE entity_type = 'order' AND entity_id = $1::uuid
       ORDER BY occurred_at ASC
       LIMIT 200`,
      [id]
    );

    const history = await pool.query<{
      at: Date;
      from: string | null;
      to: string;
      actor: string | null;
      comment: string | null;
    }>(
      `SELECT created_at AS at, status_from, status_to, changed_by::text AS actor, comment
       FROM public.order_status_history
       WHERE order_id = $1::uuid
       ORDER BY created_at ASC
       LIMIT 200`,
      [id]
    );

    const items: TimelineItem[] = [];

    for (const e of events.rows) {
      // order.status_changed дублирует историю переходов — берём из истории
      if (e.type === "order.status_changed") continue;
      items.push({
        at: new Date(e.at).toISOString(),
        type: e.type,
        title: EVENT_TITLES[e.type] ?? e.type,
        source: e.source,
        payload: e.payload ?? {},
        kind: "event",
        actor: e.actor,
      });
    }

    for (const h of history.rows) {
      items.push({
        at: new Date(h.at).toISOString(),
        type: "status",
        title:
          h.from && h.to
            ? `Статус: ${h.from} → ${h.to}`
            : `Статус: ${h.to ?? "—"}`,
        source: "app",
        payload: { from: h.from, to: h.to, comment: h.comment },
        kind: "status",
        actor: h.actor,
      });
    }

    items.sort((a, b) => a.at.localeCompare(b.at));

    return NextResponse.json({
      order: { id: order.id, number: order.number },
      timeline: items,
    });
  } catch (err) {
    console.error(
      "[orders/timeline] GET failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
