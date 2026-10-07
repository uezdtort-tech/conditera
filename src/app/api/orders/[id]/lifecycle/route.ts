/**
 * GET /api/orders/[id]/lifecycle — составные статусы заказа (ТЗ §4-5, §40).
 *
 * Единый рабочий контекст: business/payment/production/assignment/delivery
 * статусы, риск, deadline, резерв, next action, чеклист.
 *
 * Права: владелец (customer), назначенный кондитер, ADMIN/SUPER_ADMIN/SUPPORT.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getPool } from "@/lib/postgrest/pool";
import { loadOrderLite, canViewOrderChecked } from "@/lib/ops/order-access";
import { deriveLifecycle, deriveNextAction } from "@/lib/ops/lifecycle";
import { getProductionSnapshot } from "@/lib/ops/production";
import { getActiveReservation, getCapacityDay } from "@/lib/ops/capacity";
import { recalculateOrderRisk } from "@/lib/ops/risk-engine";

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

    // Пересчёт риска (лёгкий, один заказ; пишет order_production)
    const snapshot = await recalculateOrderRisk(id);

    const production = await getProductionSnapshot(id);
    const reservation = await getActiveReservation(id);

    // Ёмкость на дату плана/доставки (для UI «Capacity: OK/перегруз»)
    const capacityDate = reservation?.reservedDate ?? production.plannedDate ?? order.delivery_date;
    let capacityView: {
      utilizationPercent: number;
      freeMinutes: number;
      busyMinutes: number;
    } | null = null;
    if (order.confectioner_id && capacityDate) {
      const view = await getCapacityDay(order.confectioner_id, capacityDate);
      capacityView = {
        utilizationPercent: view.utilizationPercent,
        freeMinutes: view.freeMinutes,
        busyMinutes: view.busyMinutes,
      };
    }

    // QC/фото состояние
    const qcDone = production.checklist.some(
      (s) => s.stage_key === "quality_check" && s.is_done
    );
    const photoAttached = production.checklist.some(
      (s) => s.stage_key === "ready_photo" && s.is_done
    );

    const derived = deriveLifecycle({
      status: order.status,
      paymentStatus: order.payment_status,
      confectionerId: order.confectioner_id,
      hasReservation: Boolean(reservation),
      startedAt: production.startedAt ? new Date(production.startedAt) : null,
      qcDone,
      productionCompleted: Boolean(production.completedAt),
      handoffRecorded: false,
      deliveryType: order.delivery_type,
    });

    const nextAction = deriveNextAction({
      status: order.status,
      paymentStatus: order.payment_status,
      confectionerId: order.confectioner_id,
      hasReservation: Boolean(reservation),
      qcDone,
      productionCompleted: Boolean(production.completedAt),
      readyPhotoRequired: production.readyPhotoRequired,
      photoAttached,
      deliveryType: order.delivery_type,
    });

    // Имя кондитера (для workspace)
    let confectionerName: string | null = null;
    if (order.confectioner_id) {
      const pool = getPool();
      const nm = await pool.query<{ business_name: string | null }>(
        `SELECT "businessName" AS business_name FROM public.confectioners WHERE "userId" = $1::text LIMIT 1`,
        [order.confectioner_id]
      );
      confectionerName = nm.rows[0]?.business_name ?? null;
    }

    return NextResponse.json({
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        payment_status: order.payment_status,
        delivery_date: order.delivery_date,
        delivery_time_window: order.delivery_time_window,
        delivery_time: order.delivery_time,
        delivery_type: order.delivery_type,
        total: order.total,
        customer_id: order.user_id,
        confectioner_id: order.confectioner_id,
        confectioner_name: confectionerName,
        created_at: order.created_at,
      },
      derived,
      nextAction,
      risk: {
        level: production.riskLevel,
        reasons: production.riskReasons,
        details: snapshot?.risk.details ?? [],
        marginMinutes:
          production.latestSafeStartAt
            ? Math.round((new Date(production.latestSafeStartAt).getTime() - Date.now()) / 60_000)
            : null,
      },
      deadline: {
        deliveryDate: order.delivery_date,
        deadlineAt: production.deadlineAt,
        latestSafeStartAt: production.latestSafeStartAt,
        productionMinutes: production.estimatedMinutes,
        estimateSource: production.estimateSource,
        estimateApproximate: production.estimateApproximate,
      },
      reservation: reservation
        ? {
            id: reservation.id,
            confectionerId: reservation.confectionerId,
            date: reservation.reservedDate,
            startMinute: reservation.startMinute,
            endMinute: reservation.endMinute,
            status: reservation.status,
          }
        : null,
      capacity: capacityView,
      production: {
        startedAt: production.startedAt,
        completedAt: production.completedAt,
        readyPhotoRequired: production.readyPhotoRequired,
        checklistComplete: production.checklistComplete,
        checklist: production.checklist,
      },
    });
  } catch (err) {
    console.error(
      "[orders/lifecycle] GET failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
