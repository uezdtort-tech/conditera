/**
 * POST /api/orders/[id]/production/complete — фиксация завершения производства.
 * Каждый физический этап должен быть отдельно отмечен через /production/stage.
 * ready_photo выполняется только загрузкой файла через /media, handoff —
 * отдельным маршрутом передачи. Этот endpoint ничего не отмечает автоматически.
 *
 * Статус заказа остаётся PREPARING — финальный переход в READY делает
 * POST /api/orders/[id]/ready (QC/фото-гейт).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import { ensureChecklist, getOrderChecklist } from "@/lib/ops/production";
import { loadOrderItemsData } from "@/lib/ops/acceptance";
import { recordEvent } from "@/lib/ops/events";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
    if (!(await canOperateOrder(order, user.id))) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Нет доступа к производственному контуру заказа" },
        { status: 403 }
      );
    }

    // Нельзя закрыть производственные этапы до фактического запуска
    // производства или повторно после READY/передачи.
    if (order.status !== "PREPARING") {
      return NextResponse.json(
        {
          error: "INVALID_PRODUCTION_STATE",
          message: `Завершение производства возможно только в статусе PREPARING (сейчас ${order.status})`,
        },
        { status: 409 }
      );
    }

    // Чеклист
    const data = await loadOrderItemsData(id);
    const categorySlug = data?.items.find((i) => i.categorySlug)?.categorySlug ?? null;
    await ensureChecklist(id, categorySlug);
    const checklist = await getOrderChecklist(id);

    // Завершение — только фиксация факта после ручного подтверждения
    // каждого производственного этапа. Никаких автоматических галочек.
    // ready_photo выполняется отдельной загрузкой, handoff — после READY.
    const workStages = checklist.filter(
      (stage) => stage.stage_key !== "handoff" && stage.stage_key !== "ready_photo"
    );
    const incomplete = workStages.filter((stage) => !stage.is_done);
    if (incomplete.length > 0) {
      return NextResponse.json(
        {
          error: "PRODUCTION_CHECKLIST_INCOMPLETE",
          message: "Сначала отметьте каждый фактически выполненный этап производства",
          missing: incomplete.map((stage) => ({ stageKey: stage.stage_key, label: stage.label })),
        },
        { status: 422 }
      );
    }

    const pool = getPool();
    await pool.query(
      `UPDATE public.order_production SET completed_at = now(), updated_at = now()
       WHERE order_id = $1::uuid`,
      [id]
    );

    await recordEvent("order.production_completed", {
      entityType: "order",
      entityId: id,
      actorId: user.id,
      payload: { orderNumber: order.number, stagesConfirmed: workStages.map((stage) => stage.stage_key) },
    });

    const updated = await getOrderChecklist(id);
    const remaining = updated.filter((s) => !s.is_done && s.stage_key !== "handoff");

    return NextResponse.json({
      ok: true,
      completedAt: new Date().toISOString(),
      stagesConfirmed: workStages.map((stage) => stage.stage_key),
      remainingBeforeReady: remaining.map((s) => s.label),
      note:
        remaining.some((s) => s.stage_key === "ready_photo")
          ? "Требуется фото готовности перед отметкой «Готов»"
          : null,
    });
  } catch (err) {
    return handleRouteError(err, {
      route: "/api/orders/[id]/production/complete",
      component: "orders",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}
