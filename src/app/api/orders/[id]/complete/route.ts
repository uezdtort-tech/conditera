/**
 * POST /api/orders/[id]/complete — завершение заказа (ТЗ §37, §38, §40).
 *
 * DELIVERED → COMPLETED через lifecycle engine. После завершения:
 *   • событие order.completed (движок) + order.repeat_offer_scheduled (§38:
 *     фундамент повторного заказа — событие + метка времени, без CRM);
 *   • ORDER_REVIEW_REQUEST материализуется существующим правилом скана (§37).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";
import { applyOrderTransition, LifecycleError } from "@/lib/ops/lifecycle";
import { recordEvent } from "@/lib/ops/events";
import { materializeOpsTasks } from "@/lib/ops/rules";
import { getPool } from "@/lib/postgrest/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPEAT_OFFER_DAYS = 30;

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
    // Завершить может владелец-клиент (подтверждение получения) или стафф;
    // canOperateOrder не пропускает клиента — проверяем отдельно
    const isCustomer = order.user_id === user.id;
    if (!isCustomer && !(await canOperateOrder(order, user.id))) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Нет доступа" },
        { status: 403 }
      );
    }

    try {
      await applyOrderTransition({
        orderId: id,
        to: "COMPLETED",
        actorId: user.id,
        actorRoles: isCustomer ? ["CUSTOMER", ...user.roles] : user.roles,
      });
    } catch (err) {
      if (err instanceof LifecycleError) {
        return NextResponse.json(
          { error: err.code, message: err.message, detail: err.detail },
          { status: 409 }
        );
      }
      throw err;
    }

    // Repeat order foundation (ТЗ §38): событие + timestamp. Не CRM.
    const repeatAt = new Date(Date.now() + REPEAT_OFFER_DAYS * 86_400_000);
    await recordEvent("order.repeat_offer_scheduled", {
      entityType: "order",
      entityId: id,
      payload: {
        orderNumber: order.number,
        customerId: order.user_id,
        suggestedAt: repeatAt.toISOString(),
        repeatOf: null,
      },
    });

    // ORDER_REVIEW_REQUEST создаётся правилом при следующем скане — форсируем
    void materializeOpsTasks(true).catch(() => {});

    // Customer memory (ТЗ §39): фиксируем только реально существующие данные
    // (средний чек и связь customer→order уже в БД; отдельной модели нет —
    // не раздуваем P0.5).
    const pool = getPool();
    void pool
      .query(
        `UPDATE public.orders SET metadata = metadata || $2::jsonb WHERE id = $1::uuid`,
        [id, JSON.stringify({ completed_via: "lifecycle", repeat_offer_at: repeatAt.toISOString() })]
      )
      .catch(() => {});

    return NextResponse.json({
      ok: true,
      status: "COMPLETED",
      reviewRequestTask: "ORDER_REVIEW_REQUEST (материализуется движком)",
      repeatOfferAt: repeatAt.toISOString(),
    });
  } catch (err) {
    console.error(
      "[orders/complete] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
