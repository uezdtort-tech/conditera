/**
 * POST /api/orders/[id]/assign — назначение кондитера (ТЗ §14, §16, §28).
 *
 * Рекомендацию даёт Assignment Engine; назначение — решение админа
 * (безусловного авто-назначения нет, ТЗ §14).
 *
 * Конкурентность (ТЗ §27):
 *   • захват заказа — CAS `UPDATE orders SET confectioner_id WHERE id AND
 *     (confectioner_id IS NULL OR confectioner_id = новый)` — два параллельных
 *     назначения: выигрывает один, второй получает 409 ALREADY_ASSIGNED;
 *   • пересечение окон запрещено EXCLUDE-констрейнтом (btree_gist, 0054) —
 *     два параллельных резерва одной мощности не могут оба пройти.
 *
 * Side effects (ТЗ §6): резерв окна, чеклист/план (§17), события
 * order.assigned + order.reservation_created, уведомление кондитеру,
 * авто-resolve ORDER_UNASSIGNED (§25, через materializeOpsTasks force).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { hasAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { loadOrderLite } from "@/lib/ops/order-access";
import { loadOrderItemsData } from "@/lib/ops/acceptance";
import { estimateOrderProductionMinutes } from "@/lib/ops/production-duration";
import { computeDeadlineAt, computeLatestSafeStart, minuteToHHMM } from "@/lib/ops/deadline";
import {
  findAvailableWindow,
  reserveCapacityWindow,
  CapacityReservationError,
  releaseOrderReservation,
} from "@/lib/ops/capacity";
import { ensureChecklist } from "@/lib/ops/production";
import { recordEvent } from "@/lib/ops/events";
import { materializeOpsTasks } from "@/lib/ops/rules";
import { recalculateOrderRisk } from "@/lib/ops/risk-engine";
import { sendNotification } from "@/lib/notifications";
import { checklistTemplateForCategory } from "@/lib/ops/lifecycle-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["CANCELLED", "REFUNDED", "COMPLETED"]);

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
        { error: "FORBIDDEN", message: "Назначение доступно администратору" },
        { status: 403 }
      );
    }

    let body: { confectionerId?: string; force?: boolean };
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const confectionerId = body.confectionerId;
    if (!confectionerId || typeof confectionerId !== "string") {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Не указан confectionerId" },
        { status: 400 }
      );
    }

    // Проверить, что кондитер существует и одобрен
    const pool = getPool();
    const conf = await pool.query<{ user_id: string; name: string | null }>(
      `SELECT "userId"::text AS user_id, "businessName" AS name
       FROM public.confectioners
       WHERE "userId" = $1::uuid AND "verificationStatus" = 'approved'`,
      [confectionerId]
    );
    if (conf.rowCount === 0) {
      return NextResponse.json(
        { error: "CONFECTIONER_NOT_FOUND", message: "Кондитер не найден или не одобрен" },
        { status: 422 }
      );
    }

    const order = await loadOrderLite(id);
    if (!order) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Заказ не найден" },
        { status: 404 }
      );
    }
    if (TERMINAL_STATUSES.has(order.status)) {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", message: `Заказ в терминальном статусе ${order.status}` },
        { status: 409 }
      );
    }

    // --- CAS-захват заказа (ТЗ §27) ---
    const claim = await pool.query(
      `UPDATE public.orders SET confectioner_id = $2::uuid, updated_at = now()
       WHERE id = $1::uuid AND (confectioner_id IS NULL OR confectioner_id = $2::uuid)
       RETURNING id::text`,
      [id, confectionerId]
    );
    if (claim.rowCount === 0) {
      return NextResponse.json(
        { error: "ALREADY_ASSIGNED", message: "Заказ уже назначен другому кондитеру" },
        { status: 409 }
      );
    }

    // --- Оценка времени (ТЗ §10) ---
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

    const deadlineAt = computeDeadlineAt(
      order.delivery_date,
      order.delivery_time_window,
      order.delivery_time
    );
    const lss = deadlineAt
      ? computeLatestSafeStart({ deadlineAt, productionMinutes: estimate.minutes })
      : null;

    // --- Резерв окна (ТЗ §28) ---
    let reservation: {
      id: string;
      date: string;
      startMinute: number;
      endMinute: number;
    } | null = null;
    let capacityError: { code: string; message: string; detail?: Record<string, unknown> } | null = null;

    if (order.delivery_date) {
      const now = new Date();
      const earliest =
        order.delivery_date ===
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
          ? now.getHours() * 60 + now.getMinutes()
          : 0;
      const { window: found } = await findAvailableWindow(
        confectionerId,
        order.delivery_date,
        estimate.minutes,
        earliest
      );
      if (found) {
        try {
          const reserved = await reserveCapacityWindow({
            orderId: id,
            confectionerId,
            date: order.delivery_date,
            startMinute: found.start,
            endMinute: found.end,
            estimatedMinutes: estimate.minutes,
            createdBy: user.id,
          });
          reservation = {
            id: reserved.id,
            date: reserved.reservedDate,
            startMinute: reserved.startMinute,
            endMinute: reserved.endMinute,
          };
        } catch (err) {
          if (err instanceof CapacityReservationError && err.code === "OVERLAP") {
            // Окно занял параллельный запрос — повторный поиск
            const retry = await findAvailableWindow(
              confectionerId,
              order.delivery_date,
              estimate.minutes,
              earliest
            );
            if (retry.window) {
              try {
                const reserved2 = await reserveCapacityWindow({
                  orderId: id,
                  confectionerId,
                  date: order.delivery_date,
                  startMinute: retry.window.start,
                  endMinute: retry.window.end,
                  estimatedMinutes: estimate.minutes,
                  createdBy: user.id,
                });
                reservation = {
                  id: reserved2.id,
                  date: reserved2.reservedDate,
                  startMinute: reserved2.startMinute,
                  endMinute: reserved2.endMinute,
                };
              } catch (err2) {
                if (err2 instanceof CapacityReservationError) {
                  capacityError = { code: err2.code, message: "Не удалось закрепить окно после гонки" };
                } else throw err2;
              }
            } else {
              capacityError = {
                code: "CAPACITY_EXCEEDED",
                message: "Свободное окно исчезло (параллельное бронирование)",
              };
            }
          } else if (err instanceof CapacityReservationError && err.code === "ORDER_ALREADY_RESERVED") {
            // У заказа уже есть резерв (переназначение) — освободить и повторить
            await releaseOrderReservation(id, user.id, "released");
            const retry2 = await findAvailableWindow(
              confectionerId,
              order.delivery_date,
              estimate.minutes,
              earliest
            );
            if (retry2.window) {
              const reserved3 = await reserveCapacityWindow({
                orderId: id,
                confectionerId,
                date: order.delivery_date,
                startMinute: retry2.window.start,
                endMinute: retry2.window.end,
                estimatedMinutes: estimate.minutes,
                createdBy: user.id,
              });
              reservation = {
                id: reserved3.id,
                date: reserved3.reservedDate,
                startMinute: reserved3.startMinute,
                endMinute: reserved3.endMinute,
              };
            }
          } else {
            throw err;
          }
        }
      } else {
        // ТЗ §16: явный отказ с арифметикой
        const view = await (async () => {
          const { getCapacityDay } = await import("@/lib/ops/capacity");
          return getCapacityDay(confectionerId, order.delivery_date as string);
        })();
        if (!body.force) {
          // Откат захвата: вернуть заказ в unassigned
          await pool.query(
            `UPDATE public.orders SET confectioner_id = NULL, updated_at = now() WHERE id = $1::uuid AND confectioner_id = $2::uuid`,
            [id, confectionerId]
          );
          return NextResponse.json(
            {
              error: "CAPACITY_EXCEEDED",
              message: "Нельзя безопасно назначить: нет свободного окна",
              capacity: {
                utilizationPercent: view.utilizationPercent,
                requiredMinutes: estimate.minutes,
                availableMinutes: view.freeMinutes,
                confectionerId,
              },
              suggestion: "Назначьте другого кондитера или перенесите время выдачи",
            },
            { status: 422 }
          );
        }
        capacityError = {
          code: "CAPACITY_EXCEEDED",
          message: "Назначено с force: свободного окна нет, резерв не создан",
          detail: { utilizationPercent: view.utilizationPercent },
        };
      }
    }

    // --- Производственный план: чеклист по типу продукта (ТЗ §17-18) ---
    const categorySlug = data?.items.find((i) => i.categorySlug)?.categorySlug ?? null;
    await ensureChecklist(id, categorySlug);

    // --- order_production: оценка + latest safe start + план ---
    const plannedStartMinute = reservation?.startMinute ?? null;
    await pool.query(
      `INSERT INTO public.order_production
         (order_id, estimated_minutes, estimate_source, estimate_is_approximate,
          deadline_at, latest_safe_start_at, planned_date, planned_start_minute)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::date, $8)
       ON CONFLICT (order_id) DO UPDATE SET
         estimated_minutes = EXCLUDED.estimated_minutes,
         estimate_source = EXCLUDED.estimate_source,
         estimate_is_approximate = EXCLUDED.estimate_is_approximate,
         deadline_at = EXCLUDED.deadline_at,
         latest_safe_start_at = EXCLUDED.latest_safe_start_at,
         planned_date = COALESCE(EXCLUDED.planned_date, order_production.planned_date),
         planned_start_minute = COALESCE(EXCLUDED.planned_start_minute, order_production.planned_start_minute),
         updated_at = now()`,
      [
        id,
        estimate.minutes,
        estimate.source,
        estimate.approximate,
        deadlineAt ? deadlineAt.toISOString() : null,
        lss ? lss.latestSafeStartAt.toISOString() : null,
        reservation?.date ?? null,
        plannedStartMinute,
      ]
    );

    // --- События ---
    await recordEvent("order.assigned", {
      entityType: "order",
      entityId: id,
      actorId: user.id,
      payload: {
        orderNumber: order.number,
        confectionerId,
        confectionerName: conf.rows[0].name,
        estimatedMinutes: estimate.minutes,
        estimateSource: estimate.source,
        forced: Boolean(body.force) && !reservation,
      },
    });
    if (reservation) {
      await recordEvent("order.reservation_created", {
        entityType: "order",
        entityId: id,
        actorId: user.id,
        payload: {
          orderNumber: order.number,
          date: reservation.date,
          window: `${minuteToHHMM(reservation.startMinute)}-${minuteToHHMM(reservation.endMinute)}`,
          estimatedMinutes: estimate.minutes,
        },
      });
    }

    // --- Уведомление кондитеру (существующий шаблон, ТЗ §33) ---
    void sendNotification({
      userId: confectionerId,
      template: "ORDER_STATUS_CHANGED",
      vars: {
        orderNumber: order.number,
        statusLabel: "назначен на вас",
      },
    }).catch(() => {});

    // --- Авто-resolve ORDER_UNASSIGNED + пересчёт риска (ТЗ §25) ---
    void materializeOpsTasks(true).catch(() => {});
    void recalculateOrderRisk(id).catch(() => {});

    return NextResponse.json({
      ok: true,
      order: { id: order.id, number: order.number, confectioner_id: confectionerId },
      confectioner: { id: confectionerId, name: conf.rows[0].name },
      estimate: {
        minutes: estimate.minutes,
        source: estimate.source,
        approximate: estimate.approximate,
      },
      deadline: {
        deadlineAt: deadlineAt ? deadlineAt.toISOString() : null,
        latestSafeStartAt: lss ? lss.latestSafeStartAt.toISOString() : null,
      },
      reservation,
      warning: capacityError,
      checklistStages: checklistTemplateForCategory(categorySlug).map((s) => s.key),
    });
  } catch (err) {
    console.error(
      "[orders/assign] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
