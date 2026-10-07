/**
 * GET /api/ops/confectioner-today — экран «Сегодня» кондитера (Task 2-a).
 *
 * Права: CONFECTIONER | ADMIN | SUPER_ADMIN. Данные всегда по user.id
 * (админ видит свои — обычно пустые — секции).
 *
 * Ответ:
 * {
 *   scannedAt,
 *   tasks: { critical, important, info, items: top-5 открытых своих задач },
 *   ordersToday:      [{ id, number, status, deliveryTime, total, itemsCount, productTitles }],
 *   inProduction:     [{ ... }],
 *   lowStock:         [{ id, name, quantity, minQuantity, unit }],
 *   purchaseDrafts:   [{ id, status, source, itemsCount, totalEstimated }],  // 7 дней
 *   revenueToday: number,
 *   messagesUnread: number
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { materializeOpsTasks, type OpsScanStats } from "@/lib/ops/rules";
import { getCapacityDay } from "@/lib/ops/capacity";
import { layoutPlanTimeline, type PlannedStage } from "@/lib/ops/production";
import {
  checkOrderAcceptance,
  suggestAlternativeWindows,
  type AcceptanceResult,
} from "@/lib/ops/acceptance";
import type { SimpleOrderCard, CapacityAlert } from "@/lib/ops/lifecycle-client-types";

/**
 * P0.5 Core Adaptive (ТЗ-корректировка): простые карточки заказа для режима
 * «домашний кондитер» — человекочитаемые статусы вместо ERP-терминов.
 * Контракт: src/lib/ops/lifecycle-client-types.ts (SimpleOrderCard/CapacityAlert).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEVERITY_RANK = `CASE t.severity WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END`;

const ORDER_SHAPE = `o.id::text AS id, o.number, o.status::text AS status,
  o.delivery_time, o.total,
  o.delivery_date::text AS delivery_date,
  o.delivery_type::text AS delivery_type,
  COALESCE(p.name, '') AS customer_name,
  COALESCE(oi.items_count, 0) AS items_count,
  COALESCE(oi.titles, '{}') AS product_titles`;

const ORDER_ITEMS_LATERAL = `LEFT JOIN LATERAL (
    SELECT count(*)::int AS items_count,
           array_agg(COALESCE(oi.product_title, oi.title))::text[] AS titles
    FROM public.order_items oi
    WHERE oi.order_id = o.id
  ) oi ON true
  LEFT JOIN public.profiles p ON p.id = o.customer_id`;

interface OrderRowFull {
  // pg требует индексную сигнатуру (QueryResultRow)
  [key: string]: unknown;
  id: string;
  number: string;
  status: string;
  delivery_time: string | null;
  total: number;
  delivery_date: string | null;
  delivery_type: string | null;
  customer_name: string;
  items_count: number;
  product_titles: string[] | null;
}

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
      { status: 401 }
    );
  }
  const guard = await requireAnyRole(user.id, [
    "CONFECTIONER",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (guard) return guard;

  const pool = getPool();
  const ownerId = user.id;

  // --- tasks (rule engine; падение движка не ломает экран) ---
  let stats: OpsScanStats | null = null;
  try {
    stats = await materializeOpsTasks(false);
  } catch (err) {
    console.warn(
      "[ops/confectioner-today] materializeOpsTasks failed:",
      err instanceof Error ? err.message : err
    );
  }

  const tasks = { critical: 0, important: 0, info: 0, items: [] as unknown[] };
  try {
    const countsRows = await pool.query<{ severity: string; c: number }>(
      `SELECT t.severity, count(*)::int AS c
       FROM public.ops_tasks t
       WHERE t.status = 'open' AND t.assignee_id = $1::uuid
       GROUP BY t.severity`,
      [ownerId]
    );
    for (const row of countsRows.rows) {
      tasks[row.severity as "critical" | "important" | "info"] = row.c;
    }

    const items = await pool.query(
      `SELECT t.id, t.type, t.severity, t.title, t.description, t.payload,
              t.action_label, t.action_url, t.status, t.created_at
       FROM public.ops_tasks t
       WHERE t.status = 'open' AND t.assignee_id = $1::uuid
       ORDER BY ${SEVERITY_RANK}, t.created_at DESC
       LIMIT 5`,
      [ownerId]
    );
    tasks.items = items.rows;
  } catch (err) {
    console.warn(
      "[ops/confectioner-today] tasks block failed:",
      err instanceof Error ? err.message : err
    );
  }

  // --- ordersToday + inProduction ---
  const orderShapeError = (label: string, err: unknown) =>
    console.warn(
      `[ops/confectioner-today] ${label} failed:`,
      err instanceof Error ? err.message : err
    );

  let ordersToday: OrderRowFull[] = [];
  try {
    const { rows } = await pool.query<OrderRowFull>(
      `SELECT ${ORDER_SHAPE}
       FROM public.orders o ${ORDER_ITEMS_LATERAL}
       WHERE o.confectioner_id = $1::uuid
         AND o.delivery_date = CURRENT_DATE
         AND (o.is_draft IS NOT TRUE)
         AND o.status NOT IN ('CANCELLED', 'REFUNDED')
       ORDER BY o.delivery_time NULLS LAST`,
      [ownerId]
    );
    ordersToday = rows;
  } catch (err) {
    orderShapeError("ordersToday", err);
  }

  let inProduction: OrderRowFull[] = [];
  try {
    const { rows } = await pool.query<OrderRowFull>(
      `SELECT ${ORDER_SHAPE}, o.delivery_date AS delivery_date
       FROM public.orders o ${ORDER_ITEMS_LATERAL}
       WHERE o.confectioner_id = $1::uuid
         AND o.status IN ('CONFIRMED', 'PREPARING')
         AND o.delivery_date <= CURRENT_DATE + INTERVAL '3 days'
       ORDER BY o.delivery_date NULLS LAST, o.delivery_time NULLS LAST`,
      [ownerId]
    );
    inProduction = rows;
  } catch (err) {
    orderShapeError("inProduction", err);
  }

  // --- lowStock ---
  let lowStock: Array<Record<string, unknown>> = [];
  try {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      quantity: string;
      min_quantity: string;
      unit: string;
    }>(
      `SELECT id::text, name, quantity, min_quantity, unit
       FROM public.inventory_items
       WHERE owner_id = $1::uuid AND is_active AND quantity <= min_quantity
       ORDER BY (quantity / NULLIF(min_quantity, 0)) ASC, name`,
      [ownerId]
    );
    lowStock = rows.map((r) => ({
      id: r.id,
      name: r.name,
      quantity: Number(r.quantity),
      min_quantity: Number(r.min_quantity),
      unit: r.unit,
    }));
  } catch (err) {
    orderShapeError("lowStock", err);
  }

  // --- purchaseDrafts (7 дней) ---
  let purchaseDrafts: unknown[] = [];
  try {
    const { rows } = await pool.query(
      `SELECT d.id::text AS id, d.status, d.source,
              count(i.id)::int AS items_count,
              COALESCE(sum(i.estimated_cost), 0)::int AS total_estimated
       FROM public.purchase_drafts d
       LEFT JOIN public.purchase_draft_items i ON i.draft_id = d.id
       WHERE d.owner_id = $1::uuid AND d.created_at > now() - interval '7 days'
       GROUP BY d.id, d.status, d.source, d.created_at
       ORDER BY d.created_at DESC`,
      [ownerId]
    );
    purchaseDrafts = rows;
  } catch (err) {
    orderShapeError("purchaseDrafts", err);
  }

  // --- revenueToday ---
  let revenueToday = 0;
  try {
    const { rows } = await pool.query<{ c: number }>(
      `SELECT COALESCE(sum(total), 0)::int AS c
       FROM public.orders
       WHERE confectioner_id = $1::uuid AND paid_at::date = CURRENT_DATE`,
      [ownerId]
    );
    revenueToday = rows[0]?.c ?? 0;
  } catch (err) {
    orderShapeError("revenueToday", err);
  }

  // --- messagesUnread (упрощённо: сообщения за 24ч в каналах кондитера не от него) ---
  let messagesUnread = 0;
  try {
    const { rows } = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c
       FROM public.chat_messages m
       JOIN public.chat_channel_members cm
         ON cm.channel_id = m.channel_id AND cm.user_id = $1::uuid
       WHERE m.sender_id <> $1::uuid
         AND m.is_deleted = false
         AND m.created_at > now() - interval '24 hours'`,
      [ownerId]
    );
    messagesUnread = rows[0]?.c ?? 0;
  } catch (err) {
    orderShapeError("messagesUnread", err);
  }

  // ========================================================================
  // P0.5: Production schedule + capacity + next action (ТЗ §31)
  // ========================================================================

  // Локальная дата (совпадает с CURRENT_DATE сервера БД), не UTC
  const _now = new Date();
  const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;

  // Ёмкость на сегодня (окна, загрузка, доступно)
  let capacity: {
    utilizationPercent: number;
    freeMinutes: number;
    busyMinutes: number;
    workdayStartMinute: number;
    workdayEndMinute: number;
    isDefault: boolean;
  } | null = null;
  try {
    const view = await getCapacityDay(ownerId, todayStr);
    capacity = {
      utilizationPercent: view.utilizationPercent,
      freeMinutes: view.freeMinutes,
      busyMinutes: view.busyMinutes,
      workdayStartMinute: view.config.workdayStartMinute,
      workdayEndMinute: view.config.workdayEndMinute,
      isDefault: view.config.isDefault,
    };
  } catch (err) {
    orderShapeError("capacity", err);
  }

  // Производственный план сегодня: заказы с резервами на сегодня + их чеклисты
  interface PlanEntry {
    orderId: string;
    orderNumber: string;
    status: string;
    startMinute: number;
    endMinute: number;
    startTime: string;
    endTime: string;
    estimatedMinutes: number;
    stages: PlannedStage[];
    nextStage: string | null;
    riskLevel: string | null;
  }
  let productionPlan: PlanEntry[] = [];
  try {
    const { rows } = await pool.query<{
      order_id: string;
      number: string;
      status: string;
      start_minute: number;
      end_minute: number;
      estimated_minutes: number | null;
      risk_level: string | null;
    }>(
      `SELECT cr.order_id::text, o.number, o.status::text,
              cr.start_minute, cr.end_minute, cr.estimated_minutes,
              p.risk_level
       FROM public.capacity_reservations cr
       JOIN public.orders o ON o.id = cr.order_id
       LEFT JOIN public.order_production p ON p.order_id = o.id
       WHERE cr.confectioner_id = $1::uuid
         AND cr.reserved_date = CURRENT_DATE
         AND cr.status IN ('reserved','confirmed')
         AND o.status NOT IN ('CANCELLED','REFUNDED')
       ORDER BY cr.start_minute`,
      [ownerId]
    );

    // Чеклисты всех заказов плана одним SQL (без N+1, ТЗ §52)
    const ids = rows.map((r) => r.order_id);
    const stagesByOrder = new Map<string, Array<{ stage_key: string; label: string; sort_order: number; is_done: boolean }>>();
    if (ids.length > 0) {
      const st = await pool.query<{
        order_id: string;
        stage_key: string;
        label: string;
        sort_order: number;
        is_done: boolean;
      }>(
        `SELECT order_id::text, stage_key, label, sort_order, is_done
         FROM public.order_production_checklist
         WHERE order_id = ANY($1::uuid[])
         ORDER BY sort_order`,
        [ids]
      );
      for (const s of st.rows) {
        const list = stagesByOrder.get(s.order_id) ?? [];
        list.push(s);
        stagesByOrder.set(s.order_id, list);
      }
    }

    productionPlan = rows.map((r) => {
      const stages = stagesByOrder.get(r.order_id) ?? [];
      const est = r.estimated_minutes ?? Math.max(60, r.end_minute - r.start_minute);
      const laid = layoutPlanTimeline({
        estimatedMinutes: est,
        startMinute: r.start_minute,
        stages: stages.map((s) => ({
          id: "",
          order_id: r.order_id,
          stage_key: s.stage_key,
          label: s.label,
          sort_order: s.sort_order,
          is_done: s.is_done,
          done_at: null,
          done_by: null,
        })),
      });
      const nextStage = laid.find((s) => !s.isDone) ?? null;
      return {
        orderId: r.order_id,
        orderNumber: r.number,
        status: r.status,
        startMinute: r.start_minute,
        endMinute: r.end_minute,
        startTime: `${String(Math.floor(r.start_minute / 60)).padStart(2, "0")}:${String(r.start_minute % 60).padStart(2, "0")}`,
        endTime: `${String(Math.floor(r.end_minute / 60)).padStart(2, "0")}:${String(r.end_minute % 60).padStart(2, "0")}`,
        estimatedMinutes: est,
        stages: laid,
        nextStage: nextStage ? nextStage.label : null,
        riskLevel: r.risk_level,
      };
    });
  } catch (err) {
    orderShapeError("productionPlan", err);
  }

  // Next action (ТЗ §31): самый ранний незавершённый шаг плана сегодня
  let nextAction: { orderId: string; orderNumber: string; action: string } | null = null;
  if (productionPlan.length > 0) {
    const first = productionPlan[0];
    nextAction = {
      orderId: first.orderId,
      orderNumber: first.orderNumber,
      action: first.nextStage
        ? `Начать «${first.nextStage}» по заказу №${first.orderNumber}`
        : `Передать заказ №${first.orderNumber}`,
    };
  }

  // Attention (ТЗ §31): риск-заказы, дефициты, неотвеченные чаты
  const attention = {
    atRiskOrders: productionPlan.filter((p) => p.riskLevel === "ORANGE" || p.riskLevel === "RED").length,
    lowStockItems: lowStock.length,
    unansweredChats: messagesUnread,
  };

  // ========================================================================
  // P0.5 Core Adaptive: масштаб бизнеса + простой режим «Сегодня»
  // (ТЗ-корректировка: сложность внутри системы, а не на пользователе)
  // ========================================================================

  let businessScale = "home";
  try {
    const { rows } = await pool.query<{ business_scale: string }>(
      `SELECT business_scale FROM public.confectioners WHERE "userId" = $1::text LIMIT 1`,
      [ownerId]
    );
    businessScale = rows[0]?.business_scale ?? "home";
  } catch (err) {
    orderShapeError("businessScale", err);
  }

  /**
   * Простая карточка заказа: «Заказ №1045 — Торт…, выдать к 17:00,
   * Анна, всё необходимое есть / не хватает сливок — 500 мл».
   * todo — одна понятная кнопка на текущем этапе (без слов «production»).
   */
  const todoForStatus = (status: string, deliveryType: string | null) => {
    const isPickup = deliveryType === "pickup" || deliveryType === "self_pickup";
    switch (status) {
      case "PENDING":
        return { code: "accept" as const, label: "Принять заказ" };
      case "CONFIRMED":
        return { code: "start" as const, label: "Начать приготовление" };
      case "PREPARING":
        return { code: "ready" as const, label: "Заказ готов" };
      case "READY":
        return {
          code: "handoff" as const,
          label: isPickup ? "Передать клиенту" : "Передать курьеру",
        };
      default:
        return null;
    }
  };

  const buildSimpleCard = (o: OrderRowFull, acceptance: AcceptanceResult | null): SimpleOrderCard => {
    const titles = o.product_titles ?? [];
    const owner = acceptance?.owners?.[0] ?? null;
    const shortages = owner?.inventory?.canProduce === false ? (owner.inventory.shortages ?? []) : [];
    // Ингредиенты проверяем, только пока заказ предстоит готовить
    const needsCheck = o.status === "PENDING" || o.status === "CONFIRMED" || o.status === "PREPARING";
    const availability: SimpleOrderCard["availability"] = !needsCheck
      ? null
      : acceptance
        ? shortages.length > 0
          ? "missing_ingredients"
          : "ok"
        : "unknown";
    return {
      orderId: o.id,
      number: o.number,
      title: titles[0] ?? "Заказ",
      extraItems: Math.max(0, (o.items_count ?? 0) - 1),
      customerName: o.customer_name || null,
      deliverAt: o.delivery_time || null,
      deliveryDate: o.delivery_date ?? null,
      deliveryType: o.delivery_type ?? null,
      status: o.status,
      total: Number(o.total) || 0,
      todo: todoForStatus(o.status, o.delivery_type),
      availability,
      missing: shortages.map((s) => ({ name: s.name, shortage: s.shortage, unit: s.unit })),
      latestSafeStartAt: owner?.deadline?.latestSafeStartAt ?? null,
      capacityFits: owner?.capacity?.fits ?? null,
    };
  };

  let simpleOrders: SimpleOrderCard[] = [];
  try {
    // Проверяем дефицит/мощность только для незавершённых заказов, максимум 12
    // (защита от N+1, ТЗ §52; для остальных — availability unknown)
    const candidates = ordersToday
      .filter((o) => o.status === "PENDING" || o.status === "CONFIRMED" || o.status === "PREPARING")
      .slice(0, 12);
    const checked = new Map<string, AcceptanceResult>();
    for (const o of candidates) {
      try {
        const result = await checkOrderAcceptance(o.id);
        if (result) checked.set(o.id, result);
      } catch (err) {
        console.warn("[ops/confectioner-today] acceptance check failed:", err instanceof Error ? err.message : err);
      }
    }
    simpleOrders = ordersToday.map((o) => buildSimpleCard(o, checked.get(o.id) ?? null));
    // В производстве (до 3 дней) — тоже карточки, без повторной проверки
    const todayIds = new Set(ordersToday.map((o) => o.id));
    for (const o of inProduction) {
      if (!todayIds.has(o.id)) {
        simpleOrders.push(buildSimpleCard(o, checked.get(o.id) ?? null));
      }
    }
  } catch (err) {
    orderShapeError("simpleOrders", err);
  }

  let capacityAlert: CapacityAlert = { active: false, message: null, nearestWindow: null };
  try {
    const overloaded = simpleOrders.some((c) => c.capacityFits === false);
    if (overloaded) {
      // Самый ёмкий несозданный резерв — сколько минут нужно свободного окна
      const requiredMinutes = Math.max(
        60,
        ...productionPlan.map((p) => p.estimatedMinutes ?? p.endMinute - p.startMinute)
      );
      const windows = await suggestAlternativeWindows(ownerId, requiredMinutes, todayStr, 3, new Date());
      const first = windows[0] ?? null;
      capacityAlert = {
        active: true,
        message: first
          ? "На сегодня много заказов — есть риск не успеть"
          : "На сегодня много заказов — свободных окон в ближайшие дни нет",
        nearestWindow: first
          ? {
              date: first.date,
              startTime: `${String(Math.floor(first.start / 60)).padStart(2, "0")}:${String(first.start % 60).padStart(2, "0")}`,
            }
          : null,
      };
    }
  } catch (err) {
    orderShapeError("capacityAlert", err);
  }

  return NextResponse.json({
    scannedAt: stats?.scannedAt ?? null,
    tasks,
    ordersToday,
    inProduction,
    lowStock,
    purchaseDrafts,
    revenueToday,
    messagesUnread,
    // P0.5:
    capacity,
    productionPlan,
    nextAction,
    attention,
    // P0.5 Core Adaptive:
    businessScale,
    simpleOrders,
    capacityAlert,
  });
}
