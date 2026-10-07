/**
 * POST /api/orders/[id]/acceptance-check — перепроверка выполнимости
 * существующего заказа (ТЗ §8, §40).
 *
 * Ответ — структурированный результат Acceptance Engine
 * (inventory + capacity + deadline + procurement ETA).
 *
 * Права: назначенный кондитер, ADMIN/SUPER_ADMIN (клиент не оперирует
 * производственным контуром).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import { checkOrderAcceptance } from "@/lib/ops/acceptance";
import { recordEvent } from "@/lib/ops/events";

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

    const result = await checkOrderAcceptance(id);
    if (!result) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Заказ не найден" },
        { status: 404 }
      );
    }

    // Событие о неудачной проверке (для операционной видимости, fail-safe)
    if (!result.canAccept) {
      void recordEvent("order.acceptance_rejected", {
        entityType: "order",
        entityId: id,
        actorId: user.id,
        payload: {
          orderNumber: order.number,
          reasons: result.reasons.map((r) => r.code),
        },
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error(
      "[orders/acceptance-check] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
