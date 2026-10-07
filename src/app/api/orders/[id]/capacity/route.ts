/**
 * GET /api/orders/[id]/capacity — ёмкость исполнителя на дату заказа (ТЗ §9, §40).
 *
 * Свободные окна, загрузка, занятые интервалы (кондитер видит свои,
 * админ — любые).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { loadOrderLite, canViewOrderChecked } from "@/lib/ops/order-access";
import { getCapacityDay, getActiveReservation } from "@/lib/ops/capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    if (!order.confectioner_id) {
      return NextResponse.json(
        { error: "NO_CONFECTIONER", message: "Кондитер не назначен — ёмкость не определена" },
        { status: 422 }
      );
    }

    const reservation = await getActiveReservation(id);
    const date = reservation?.reservedDate ?? order.delivery_date;
    if (!date) {
      return NextResponse.json(
        { error: "NO_DATE", message: "Дата доставки/плана не указана" },
        { status: 422 }
      );
    }

    const view = await getCapacityDay(order.confectioner_id, date);

    return NextResponse.json({
      order: { id: order.id, number: order.number },
      confectionerId: order.confectioner_id,
      date,
      config: {
        workdayStartMinute: view.config.workdayStartMinute,
        workdayEndMinute: view.config.workdayEndMinute,
        dailyCapacityMinutes: view.config.dailyCapacityMinutes,
        isDefault: view.config.isDefault,
      },
      busy: view.busy,
      freeWindows: view.freeWindows,
      freeMinutes: view.freeMinutes,
      busyMinutes: view.busyMinutes,
      utilizationPercent: view.utilizationPercent,
      reservation: reservation
        ? {
            id: reservation.id,
            startMinute: reservation.startMinute,
            endMinute: reservation.endMinute,
            status: reservation.status,
            estimatedMinutes: reservation.estimatedMinutes,
          }
        : null,
    });
  } catch (err) {
    console.error(
      "[orders/capacity] GET failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
