/**
 * lifecycle.ts — State Transition Engine P0.5 (ТЗ §4, §5, §6).
 *
 * Адаптируется к СУЩЕСТВУЮЩЕЙ модели статусов (ТЗ §4.1: «не заменять её
 * механически»): orders.status (order_status enum из 0001) — бизнес-статус,
 * orders.payment_status — платёжный статус (НЕ смешиваются, ТЗ §5).
 * Производственный/назначенческий/доставочный статусы — ПРОИЗВОДНЫЕ
 * (derivation, без новых параллельных полей-дубликатов).
 *
 * Каждый переход (ТЗ §6):
 *   1. проверяет разрешённость (матрица ORDER_TRANSITIONS);
 *   2. проверяет условия (payment gate, назначение, QC/фото-гейт);
 *   3. изменяет состояние АТОМАРНО (SELECT ... FOR UPDATE + CAS UPDATE);
 *   4. пишет событие (domain_events через recordEvent + n8n emit);
 *   5. пишет order_status_history (audit, ТЗ §44);
 *   6. сопровождает side effects (резерв: reserved→confirmed→released,
 *      уведомления — существующими шаблонами notifications).
 *
 * Запрещённые переходы → LifecycleError (ТЗ §6: created→completed,
 * cancelled→in_production, refunded→completed и т.п.).
 */

import { type PoolClient } from "pg";
import { getPool } from "@/lib/postgrest/pool";
import { recordEvent } from "./events";
import { emitEvent } from "@/lib/n8n";
import { releaseOrderReservation, getActiveReservation } from "./capacity";
import { sendNotification } from "@/lib/notifications";
import {
  readyPhotoRequiredForCategory,
} from "./lifecycle-config";

// ---------------------------------------------------------------------------
// Матрица переходов (ТЗ §6)
// ---------------------------------------------------------------------------

export type OrderRole =
  | "CUSTOMER"
  | "CONFECTIONER"
  | "COURIER"
  | "ADMIN"
  | "SUPER_ADMIN"
  | "INSPECTOR"
  | string;

export interface TransitionDef {
  to: string;
  roles: OrderRole[];
  /** Условия выполнения (кроме ролей). */
  condition?: "payment_confirmed_or_cash" | "assignment_required";
  /** Человекочитаемое имя для событий/уведомлений. */
  label: string;
  /** Доменное событие (ops event log). */
  event: string;
  /** Шаблон уведомления (существующий, src/lib/notifications.ts). */
  notification?: string;
  /** Кому адресовать уведомление: customer | confectioner. */
  notify?: Array<"customer" | "confectioner">;
}

/**
 * Матрица поверх СУЩЕСТВУЮЩИХ статусов. Роли совпадают с существующей
 * матрицей PATCH /api/orders/[id] (расширена: CONFIRMED→CANCELLED,
 * PREPARING→CANCELLED для админа, NEGOTIATING-ветка).
 */
export const ORDER_TRANSITIONS: Record<string, TransitionDef[]> = {
  PENDING: [
    {
      to: "CONFIRMED",
      roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"],
      condition: "payment_confirmed_or_cash",
      label: "заказ принят",
      event: "order.accepted",
      notification: "ORDER_ACCEPTED",
      notify: ["customer"],
    },
    {
      to: "CANCELLED",
      roles: ["CUSTOMER", "CONFECTIONER", "ADMIN", "SUPER_ADMIN"],
      label: "заказ отменён",
      event: "order.cancelled",
      notification: "ORDER_CANCELLED",
      notify: ["customer", "confectioner"],
    },
  ],
  NEGOTIATING: [
    {
      to: "CONFIRMED",
      roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"],
      condition: "payment_confirmed_or_cash",
      label: "заказ принят",
      event: "order.accepted",
      notification: "ORDER_ACCEPTED",
      notify: ["customer"],
    },
    {
      to: "CANCELLED",
      roles: ["CUSTOMER", "CONFECTIONER", "ADMIN", "SUPER_ADMIN"],
      label: "заказ отменён",
      event: "order.cancelled",
      notification: "ORDER_CANCELLED",
      notify: ["customer"],
    },
  ],
  CONFIRMED: [
    {
      to: "PREPARING",
      roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"],
      condition: "assignment_required",
      label: "производство начато",
      event: "order.production_started",
      notification: "ORDER_IN_PRODUCTION",
      notify: ["customer"],
    },
    {
      to: "CANCELLED",
      roles: ["ADMIN", "SUPER_ADMIN"],
      label: "заказ отменён",
      event: "order.cancelled",
      notification: "ORDER_CANCELLED",
      notify: ["customer", "confectioner"],
    },
  ],
  PREPARING: [
    {
      to: "READY",
      roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"],
      label: "заказ готов",
      event: "order.ready",
      notification: "ORDER_READY",
      notify: ["customer"],
    },
    {
      to: "CANCELLED",
      roles: ["ADMIN", "SUPER_ADMIN"],
      label: "заказ отменён",
      event: "order.cancelled",
      notification: "ORDER_CANCELLED",
      notify: ["customer", "confectioner"],
    },
  ],
  READY: [
    {
      to: "IN_DELIVERY",
      roles: ["COURIER", "ADMIN", "SUPER_ADMIN"],
      label: "передан в доставку",
      event: "order.delivery_started",
      notification: "ORDER_OUT_FOR_DELIVERY",
      notify: ["customer"],
    },
    {
      // Самовывоз: подтверждение передачи клиенту (ТЗ §36 handoff)
      to: "DELIVERED",
      roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"],
      label: "передан клиенту",
      event: "order.handed_off",
      notification: "ORDER_DELIVERED",
      notify: ["customer"],
    },
    {
      to: "CANCELLED",
      roles: ["ADMIN", "SUPER_ADMIN"],
      label: "заказ отменён",
      event: "order.cancelled",
      notification: "ORDER_CANCELLED",
      notify: ["customer"],
    },
  ],
  IN_DELIVERY: [
    {
      to: "DELIVERED",
      roles: ["COURIER", "ADMIN", "SUPER_ADMIN"],
      label: "доставлен",
      event: "order.delivered",
      notification: "ORDER_DELIVERED",
      notify: ["customer"],
    },
  ],
  DELIVERED: [
    {
      to: "COMPLETED",
      roles: ["CUSTOMER", "ADMIN", "SUPER_ADMIN"],
      label: "заказ завершён",
      event: "order.completed",
      notification: "ORDER_RECEIVED",
      notify: ["confectioner"],
    },
    {
      to: "REFUNDED",
      roles: ["ADMIN", "SUPER_ADMIN", "INSPECTOR"],
      label: "заказ возвращён",
      event: "order.refunded",
    },
  ],
};

export function isTransitionAllowed(from: string, to: string): TransitionDef | null {
  const defs = ORDER_TRANSITIONS[from];
  if (!defs) return null;
  return defs.find((d) => d.to === to) ?? null;
}

// ---------------------------------------------------------------------------
// Ошибки
// ---------------------------------------------------------------------------

export type LifecycleErrorCode =
  | "INVALID_TRANSITION"
  | "FORBIDDEN_ROLE"
  | "PAYMENT_NOT_CONFIRMED"
  | "ASSIGNMENT_REQUIRED"
  | "QC_GATE_FAILED"
  | "READY_PHOTO_REQUIRED"
  | "ORDER_NOT_FOUND";

export class LifecycleError extends Error {
  code: LifecycleErrorCode;
  detail?: string;
  constructor(code: LifecycleErrorCode, message: string, detail?: string) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Составные статусы (ТЗ §5) — derivation без дублей в БД
// ---------------------------------------------------------------------------

export type BusinessStatus =
  | "created"
  | "confirmed"
  | "in_production"
  | "ready"
  | "completed"
  | "cancelled";

export type ProductionStatus =
  | "not_started"
  | "planned"
  | "in_production"
  | "quality_check"
  | "ready";

export type AssignmentStatus = "unassigned" | "assigned" | "reassignment_required";

export type DeliveryStatus =
  | "not_ready"
  | "ready_for_handoff"
  | "handed_off"
  | "in_delivery"
  | "delivered";

export interface DerivedLifecycle {
  businessStatus: BusinessStatus;
  productionStatus: ProductionStatus;
  assignmentStatus: AssignmentStatus;
  deliveryStatus: DeliveryStatus;
}

const BUSINESS_MAP: Record<string, BusinessStatus> = {
  PENDING: "created",
  NEGOTIATING: "created",
  CONFIRMED: "confirmed",
  PREPARING: "in_production",
  READY: "ready",
  IN_DELIVERY: "ready",
  DELIVERED: "completed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  REFUNDED: "cancelled",
};

/** Составные статусы из атомарных полей (orders + order_production + резерв). */
export function deriveLifecycle(params: {
  status: string;
  paymentStatus: string;
  confectionerId: string | null;
  hasReservation: boolean;
  startedAt: Date | boolean | null;
  qcDone: boolean;
  productionCompleted: boolean;
  handoffRecorded: boolean;
  deliveryType: string | null;
}): DerivedLifecycle {
  const businessStatus = BUSINESS_MAP[params.status] ?? "created";

  let productionStatus: ProductionStatus = "not_started";
  if (params.status === "CONFIRMED") {
    productionStatus = params.hasReservation ? "planned" : "not_started";
  } else if (params.status === "PREPARING") {
    if (params.productionCompleted && params.qcDone) productionStatus = "ready";
    else if (params.qcDone || params.productionCompleted) productionStatus = "quality_check";
    else productionStatus = params.startedAt ? "in_production" : "planned";
  } else if (["READY", "IN_DELIVERY", "DELIVERED", "COMPLETED"].includes(params.status)) {
    productionStatus = "ready";
  }

  // reassignment_required вычисляется вызывающим (risk CAPACITY_EXCEEDED /
  // ops-задача ORDER_REASSIGNMENT_REQUIRED) — здесь чисто по факту назначения.
  const assignmentStatus: AssignmentStatus = params.confectionerId ? "assigned" : "unassigned";

  let deliveryStatus: DeliveryStatus = "not_ready";
  if (params.status === "READY") {
    deliveryStatus = params.handoffRecorded ? "handed_off" : "ready_for_handoff";
  } else if (params.status === "IN_DELIVERY") {
    deliveryStatus = "in_delivery";
  } else if (["DELIVERED", "COMPLETED"].includes(params.status)) {
    deliveryStatus = "delivered";
  }

  return { businessStatus, productionStatus, assignmentStatus, deliveryStatus };
}

// ---------------------------------------------------------------------------
// Применение перехода
// ---------------------------------------------------------------------------

export interface ApplyTransitionInput {
  orderId: string;
  to: string;
  actorId: string;
  actorRoles: string[];
  comment?: string | null;
  /**
   * Внутренний вызов движком (production/ready endpoints) — пропускает
   * проверку ролей (роль проверена вызывающим endpoint'ом).
   */
  skipRoleCheck?: boolean;
}

export interface ApplyTransitionResult {
  orderId: string;
  orderNumber: string;
  from: string;
  to: string;
  event: string;
  customerId: string;
  confectionerId: string | null;
}

interface OrderRow {
  id: string;
  number: string;
  status: string;
  user_id: string;
  confectioner_id: string | null;
  payment_status: string;
  payment_method: string | null;
  delivery_type: string | null;
  category_slug: string | null;
}

const PAID_PAYMENT_STATUSES = new Set(["escrow", "succeeded", "released"]);

/**
 * Применить переход жизненного цикла. Атомарно (FOR UPDATE + CAS),
 * с проверкой условий, событием, историей и side effects.
 */
export async function applyOrderTransition(
  input: ApplyTransitionInput
): Promise<ApplyTransitionResult> {
  const pool = getPool();

  // --- 1. Загрузить заказ с блокировкой строки ---
  const client = await pool.connect();
  let from = "";
  let def: TransitionDef | null = null;
  let order: OrderRow | null = null;

  try {
    await client.query("BEGIN");
    const res = await client.query<Omit<OrderRow, "category_slug">>(
      `SELECT o.id::text, o.number, o.status::text, o.user_id::text,
              o.confectioner_id::text, o.payment_status::text,
              o.payment_method, o.delivery_type
       FROM public.orders o
       WHERE o.id = $1::uuid
       LIMIT 1`,
      [input.orderId]
    );
    const row = res.rows[0];
    if (!row) {
      throw new LifecycleError("ORDER_NOT_FOUND", "Заказ не найден");
    }
    // Если у заказа несколько позиций, category_slug берём приоритетно «торт»
    const catRes = await client.query<{ slug: string | null }>(
      `SELECT c.slug
       FROM public.order_items oi
       JOIN public.products p ON p.id = oi.product_id
       JOIN public.product_categories c ON c.id = p.category_id
       WHERE oi.order_id = $1::uuid
       ORDER BY CASE WHEN c.slug IN ('cakes','realistic_cakes','bento') THEN 0 ELSE 1 END
       LIMIT 1`,
      [input.orderId]
    );
    // Категория — приоритетно «тортовая» (фото-гейт §35): от первой позиции заказа
    order = { ...row, category_slug: catRes.rows[0]?.slug ?? null };

    from = order.status;
    def = isTransitionAllowed(from, input.to);
    if (!def) {
      throw new LifecycleError(
        "INVALID_TRANSITION",
        `Запрещённый переход: ${from} → ${input.to}`,
        `allowed: ${ORDER_TRANSITIONS[from]?.map((d) => d.to).join(", ") ?? "none"}`
      );
    }

    // --- 2. Роли ---
    if (!input.skipRoleCheck) {
      const hasRole = def.roles.some((r) => input.actorRoles.includes(r));
      if (!hasRole) {
        throw new LifecycleError(
          "FORBIDDEN_ROLE",
          `Роль не позволяет перейти ${from} → ${input.to}`
        );
      }
      // Исполнитель меняет только свои заказы (кроме админов)
      const isStaff = input.actorRoles.includes("ADMIN") || input.actorRoles.includes("SUPER_ADMIN");
      if (!isStaff && input.actorRoles.includes("CONFECTIONER") && order.confectioner_id !== input.actorId) {
        throw new LifecycleError("FORBIDDEN_ROLE", "Можно менять только назначенные вам заказы");
      }
    }

    // --- 3. Условия ---
    if (def.condition === "payment_confirmed_or_cash") {
      const paid = PAID_PAYMENT_STATUSES.has(order.payment_status);
      const cash = order.payment_method === "cash";
      if (!paid && !cash) {
        throw new LifecycleError(
          "PAYMENT_NOT_CONFIRMED",
          "Оплата не подтверждена — переход невозможен",
          `payment_status=${order.payment_status}`
        );
      }
    }

    const qcGateNeeded = from === "PREPARING" && input.to === "READY";
    if (qcGateNeeded) {
      const gate = await checkReadyGate(client, input.orderId, order.category_slug);
      if (!gate.ok) {
        if (gate.photoMissing) {
          throw new LifecycleError(
            "READY_PHOTO_REQUIRED",
            "Требуется фото готовности перед отметкой «Готов» (ТЗ §35)",
            gate.missing.join(", ")
          );
        }
        throw new LifecycleError(
          "QC_GATE_FAILED",
          "Чеклист производства не завершён",
          gate.missing.join(", ")
        );
      }
    }

    // --- 4. Атомарное изменение (CAS) ---
    const updates: Record<string, unknown> = { status: input.to };
    if (input.to === "CONFIRMED") updates.confirmed_at = new Date().toISOString();
    if (input.to === "IN_DELIVERY") updates.shipped_at = new Date().toISOString();
    if (input.to === "DELIVERED") updates.delivered_at = new Date().toISOString();
    if (input.to === "COMPLETED") updates.completed_at = new Date().toISOString();
    if (input.to === "CANCELLED") updates.cancelled_at = new Date().toISOString();

    const upd = await client.query(
      `UPDATE public.orders SET status = $2, confirmed_at = COALESCE($3, confirmed_at),
              shipped_at = COALESCE($4, shipped_at), delivered_at = COALESCE($5, delivered_at),
              completed_at = COALESCE($6, completed_at), cancelled_at = COALESCE($7, cancelled_at),
              updated_at = now()
       WHERE id = $1::uuid AND status = $8
       RETURNING id::text`,
      [
        input.orderId,
        input.to,
        updates.confirmed_at ?? null,
        updates.shipped_at ?? null,
        updates.delivered_at ?? null,
        updates.completed_at ?? null,
        updates.cancelled_at ?? null,
        from,
      ]
    );
    if (upd.rowCount === 0) {
      throw new LifecycleError("INVALID_TRANSITION", "Заказ изменён параллельно (race), повторите");
    }

    // --- 5. История (audit) ---
    await client.query(
      `INSERT INTO public.order_status_history (order_id, status_from, status_to, changed_by, comment)
       VALUES ($1::uuid, $2, $3, $4::uuid, $5)`,
      [input.orderId, from, input.to, input.actorId, input.comment ?? null]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    if (err instanceof LifecycleError) throw err;
    throw new LifecycleError("INVALID_TRANSITION", "Ошибка перехода", (err as Error).message);
  }
  client.release();

  // --- 6. Side effects (после коммита; fail-safe) ---
  const result: ApplyTransitionResult = {
    orderId: input.orderId,
    orderNumber: order!.number,
    from,
    to: input.to,
    event: def!.event,
    customerId: order!.user_id,
    confectionerId: order!.confectioner_id,
  };

  try {
    // Резерв: reserved → confirmed (старт производства); released (готово/отменено)
    if (input.to === "PREPARING") {
      await pool.query(
        `UPDATE public.capacity_reservations SET status='confirmed'
         WHERE order_id = $1::uuid AND status = 'reserved'`,
        [input.orderId]
      );
    }
    if (["READY", "CANCELLED", "REFUNDED", "COMPLETED"].includes(input.to)) {
      await releaseOrderReservation(input.orderId, input.actorId, "released");
    }
  } catch (e) {
    console.warn("[ops/lifecycle] reservation side effect failed:", (e as Error).message);
  }

  // События: ops event log + n8n (fail-safe)
  void recordEvent(def!.event, {
    entityType: "order",
    entityId: input.orderId,
    actorId: input.actorId,
    payload: { from, to: input.to, orderNumber: order!.number },
  });
  if (input.to !== "CANCELLED") {
    // order.cancelled уже эмитится cancel-роутом в n8n — не дублируем
    void emitEvent("order.status_changed", {
      orderId: input.orderId,
      from,
      to: input.to,
    }).catch(() => {});
  }
  void recordEvent("order.status_changed", {
    entityType: "order",
    entityId: input.orderId,
    actorId: input.actorId,
    payload: { from, to: input.to, orderNumber: order!.number },
  });

  // Уведомление существующим шаблоном (fail-safe)
  if (def!.notification && def!.notify?.length) {
    void (async () => {
      try {
        const targets: Array<{ userId: string; vars: Record<string, string> }> = [];
        if (def!.notify!.includes("customer")) {
          targets.push({ userId: order!.user_id, vars: { orderNumber: order!.number } });
        }
        if (def!.notify!.includes("confectioner") && order!.confectioner_id) {
          targets.push({ userId: order!.confectioner_id, vars: { orderNumber: order!.number } });
        }
        for (const t of targets) {
          await sendNotification({
            userId: t.userId,
            template: def!.notification as never,
            vars: t.vars,
          });
        }
      } catch (e) {
        console.warn("[ops/lifecycle] notification failed:", (e as Error).message);
      }
    })();
  }

  return result;
}

// ---------------------------------------------------------------------------
// QC/фото-гейт PREPARING → READY (ТЗ §17-18, §35)
// ---------------------------------------------------------------------------

export interface ReadyGateResult {
  ok: boolean;
  missing: string[];
  photoMissing: boolean;
}

/** Минимальный контракт клиента (Pool-клиент или пул) для гейта. */
interface QueryableClient {
  query: PoolClient["query"];
}

/**
 * Гейт готовности: все этапы чеклиста, кроме handoff, выполнены;
 * если требуется фото готовности — оно приложено.
 */
export async function checkReadyGate(
  client: QueryableClient,
  orderId: string,
  categorySlug: string | null
): Promise<ReadyGateResult> {
  const missing: string[] = [];

  const cl = await client.query(
    `SELECT stage_key, label, is_done FROM public.order_production_checklist
     WHERE order_id = $1::uuid`,
    [orderId]
  );
  for (const row of cl.rows as Array<{ stage_key: string; label: string; is_done: boolean }>) {
    // handoff выполняется после READY — не блокирует готовность
    if (row.stage_key === "handoff") continue;
    if (!row.is_done) missing.push(row.label);
  }

  const photoRequired = readyPhotoRequiredForCategory(categorySlug);
  let photoMissing = false;
  if (photoRequired) {
    const pm = await client.query(
      `SELECT count(*)::int AS c FROM public.order_media
       WHERE order_id = $1::uuid AND kind = 'ready_photo' AND status = 'approved'`,
      [orderId]
    );
    const c = (pm.rows[0] as { c: number } | undefined)?.c ?? 0;
    if (c === 0) {
      photoMissing = true;
      missing.push("Фото готовности");
    }
  }

  return { ok: missing.length === 0, missing, photoMissing };
}

// ---------------------------------------------------------------------------
// Next action (ТЗ «какое действие требуется от пользователя»)
// ---------------------------------------------------------------------------

export interface NextAction {
  code: string;
  label: string;
}

/** Производный «следующий шаг» по состояниям. */
export function deriveNextAction(params: {
  status: string;
  paymentStatus: string;
  confectionerId: string | null;
  hasReservation: boolean;
  qcDone: boolean;
  productionCompleted: boolean;
  readyPhotoRequired: boolean;
  photoAttached: boolean;
  deliveryType: string | null;
}): NextAction {
  const paid = PAID_PAYMENT_STATUSES.has(params.paymentStatus);
  switch (params.status) {
    case "PENDING":
    case "NEGOTIATING":
      if (!paid) return { code: "WAIT_PAYMENT", label: "Ожидание оплаты" };
      if (!params.confectionerId)
        return { code: "ASSIGN", label: "Назначить кондитера" };
      return { code: "PLAN", label: "Спланировать производство" };
    case "CONFIRMED":
      if (!params.confectionerId)
        return { code: "ASSIGN", label: "Назначить кондитера" };
      if (!params.hasReservation)
        return { code: "PLAN", label: "Закрепить окно производства" };
      return { code: "START_PRODUCTION", label: "Начать производство" };
    case "PREPARING": {
      if (!params.qcDone)
        return { code: "CONTINUE_PRODUCTION", label: "Продолжить производство" };
      if (params.readyPhotoRequired && !params.photoAttached)
        return { code: "ATTACH_READY_PHOTO", label: "Приложить фото готовности" };
      return { code: "MARK_READY", label: "Отметить готовность" };
    }
    case "READY":
      return params.deliveryType === "pickup" || params.deliveryType === "self_pickup"
        ? { code: "HANDOFF_CUSTOMER", label: "Передать клиенту" }
        : { code: "HANDOFF_COURIER", label: "Передать курьеру" };
    case "IN_DELIVERY":
      return { code: "CONFIRM_DELIVERY", label: "Подтвердить доставку" };
    case "DELIVERED":
      return { code: "COMPLETE", label: "Подтвердить завершение" };
    case "COMPLETED":
      return { code: "REVIEW", label: "Запросить отзыв" };
    case "CANCELLED":
    case "REFUNDED":
      return { code: "NONE", label: "—" };
    default:
      return { code: "NONE", label: "—" };
  }
}

/** Загрузить активный резерв (обёртка для UI-агрегатов). */
export async function loadActiveReservation(orderId: string) {
  return getActiveReservation(orderId);
}
