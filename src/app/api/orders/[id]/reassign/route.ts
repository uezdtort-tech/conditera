/**
 * POST /api/orders/[id]/reassign — переназначение кондитера (ТЗ §50).
 *
 * Сценарий ТЗ §50: кондитер A перегружен → рекомендация B → подтверждение
 * → освободить резерв A → закрепить B → заказ продолжается.
 *
 * Шаги: release старого резерва → CAS-смена confectioner_id →
 * резерв новому → чеклист сохраняется → события order.reassigned +
 * order.reservation_released/created → авто-resolve задач риска.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { hasAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { loadOrderLite } from "@/lib/ops/order-access";
import { loadOrderItemsData } from "@/lib/ops/acceptance";
import { estimateOrderProductionMinutes } from "@/lib/ops/production-duration";
import { minuteToHHMM } from "@/lib/ops/deadline";
import {
  findAvailableWindow,
  reserveCapacityWindow,
  releaseOrderReservation,
  getActiveReservation,
  CapacityReservationError,
} from "@/lib/ops/capacity";
import { ensureChecklist } from "@/lib/ops/production";
import { recordEvent } from "@/lib/ops/events";
import { materializeOpsTasks } from "@/lib/ops/rules";
import { recalculateOrderRisk } from "@/lib/ops/risk-engine";
import { sendNotification } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLOCKED_STATUSES = new Set(["CANCELLED", "REFUNDED", "COMPLETED"]);

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
    if (!(await hasAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]))) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Переназначение доступно администратору" },
        { status: 403 }
      );
    }

    let body: { confectionerId?: string };
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const confectionerId = body.confectionerId;
    if (!confectionerId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Не указан confectionerId" },
        { status: 400 }
      );
    }

    const order = await loadOrderLite(id);
    if (!order) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Заказ не найден" },
        { status: 404 }
      );
    }
    if (BLOCKED_STATUSES.has(order.status)) {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", message: `Заказ в статусе ${order.status}` },
        { status: 409 }
      );
    }
    const previousConfectionerId = order.confectioner_id;
    if (previousConfectionerId === confectionerId) {
      return NextResponse.json(
        { error: "SAME_CONFECTIONER", message: "Кондитер уже назначен" },
        { status: 422 }
      );
    }

    // Новый кондитер существует и одобрен
    const pool = getPool();
    const conf = await pool.query<{ user_id: string; name: string | null }>(
      `SELECT "userId"::text AS user_id, "businessName" AS name
       FROM public.confectioners
       WHERE "userId" = $1::text AND "verificationStatus" = 'approved'`,
      [confectionerId]
    );
    if (conf.rowCount === 0) {
      return NextResponse.json(
        { error: "CONFECTIONER_NOT_FOUND", message: "Кондитер не найден или не одобрен" },
        { status: 422 }
      );
    }

    // 1. Освободить резерв старого исполнителя (ТЗ §50: release reservation A)
    const oldReservation = await getActiveReservation(id);
    if (oldReservation) {
      await releaseOrderReservation(id, user.id, "released");
      await recordEvent("order.reservation_released", {
        entityType: "order",
        entityId: id,
        actorId: user.id,
        payload: {
          orderNumber: order.number,
          confectionerId: oldReservation.confectionerId,
          date: oldReservation.reservedDate,
        },
      });
    }

    // 2. CAS-смена исполнителя
    const claim = await pool.query(
      `UPDATE public.orders SET confectioner_id = $2::uuid, updated_at = now()
       WHERE id = $1::uuid
       RETURNING id::text`,
      [id, confectionerId]
    );
    if (claim.rowCount === 0) {
      return NextResponse.json(
        { error: "REASSIGN_FAILED", message: "Не удалось сменить исполнителя" },
        { status: 409 }
      );
    }

    // 3. Оценка времени + резерв новому
    const data = await loadOrderItemsData(id);
    const estimate = estimateOrderProductionMinutes(
      (data?.items ?? []).map((i) => ({
        quantity: i.quantity,
        time: {
          productProductionTimeHours: i.productionTimeHours,
          recipePrepMinutes: i.recipePrepMinutes,
          recipeCookMinutes: i.recipeCookMinutes,
          categorySlug: i.categorySlug,
        },
      }))
    );

    let reservation: { id: string; date: string; startMinute: number; endMinute: number } | null = null;
    let capacityWarning: string | null = null;

    if (order.delivery_date) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const earliest = order.delivery_date === todayStr ? now.getHours() * 60 + now.getMinutes() : 0;
      const { window: found } = await findAvailableWindow(
        confectionerId,
        order.delivery_date,
        estimate.minutes,
        earliest
      );
      if (found) {
        try {
          const r = await reserveCapacityWindow({
            orderId: id,
            confectionerId,
            date: order.delivery_date,
            startMinute: found.start,
            endMinute: found.end,
            estimatedMinutes: estimate.minutes,
            createdBy: user.id,
          });
          reservation = {
            id: r.id,
            date: r.reservedDate,
            startMinute: r.startMinute,
            endMinute: r.endMinute,
          };
        } catch (err) {
          if (err instanceof CapacityReservationError) {
            capacityWarning = `Окно не закреплено: ${err.message}`;
          } else throw err;
        }
      } else {
        capacityWarning = "У нового кондитера нет свободного окна на дату заказа — резерв не создан";
      }
    }

    await ensureChecklist(id, data?.items.find((i) => i.categorySlug)?.categorySlug ?? null);

    // 4. События + уведомления
    await recordEvent("order.reassigned", {
      entityType: "order",
      entityId: id,
      actorId: user.id,
      payload: {
        orderNumber: order.number,
        from: previousConfectionerId,
        to: confectionerId,
        estimatedMinutes: estimate.minutes,
      },
    });
    if (reservation) {
      await recordEvent("order.reservation_created", {
        entityType: "order",
        entityId: id,
        actorId: user.id,
        payload: {
          orderNumber: order.number,
          confectionerId,
          date: reservation.date,
          window: `${minuteToHHMM(reservation.startMinute)}-${minuteToHHMM(reservation.endMinute)}`,
        },
      });
    }

    void sendNotification({
      userId: confectionerId,
      template: "ORDER_STATUS_CHANGED",
      vars: { orderNumber: order.number, statusLabel: "назначен на вас (переназначение)" },
      metadata: { orderId: id },
    }).catch(() => {});

    // 5. Авто-resolve (риск может уйти в GREEN — задачи закроются сами)
    void materializeOpsTasks(true).catch(() => {});
    void recalculateOrderRisk(id).catch(() => {});

    return NextResponse.json({
      ok: true,
      order: { id: order.id, number: order.number },
      previousConfectionerId,
      confectioner: { id: confectionerId, name: conf.rows[0].name },
      estimate: {
        minutes: estimate.minutes,
        source: estimate.source,
        approximate: estimate.approximate,
      },
      reservation,
      warning: capacityWarning,
    });
  } catch (err) {
    console.error(
      "[orders/reassign] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
