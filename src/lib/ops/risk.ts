/**
 * risk.ts — Risk Engine P0.5 (ТЗ §12, §13).
 *
 * GREEN  — всё выполняется с запасом;
 * YELLOW — запас небольшой;
 * ORANGE — есть вероятность нарушения SLA;
 * RED    — текущий план не позволяет выполнить заказ вовремя.
 *
 * Чистая функция computeOrderRisk(): детерминированно, без LLM (ТЗ §54).
 * Коды причин (ТЗ §12): LOW_STOCK, NO_CONFECTIONER, CAPACITY_EXCEEDED,
 * PRODUCTION_NOT_STARTED, DEADLINE_TOO_CLOSE, DELIVERY_RISK,
 * PAYMENT_NOT_CONFIRMED, MISSING_PRODUCT_DATA.
 */

import {
  RISK_YELLOW_MARGIN_MINUTES,
  RISK_ORANGE_MARGIN_MINUTES,
  RISK_DEADLINE_TOO_CLOSE_MINUTES,
  type RiskLevel,
  type RiskReasonCode,
} from "./lifecycle-config";
import { marginMinutes } from "./deadline";

export interface RiskOrderSnapshot {
  status: string; // orders.status
  paymentStatus: string; // orders.payment_status
  confectionerId: string | null;
  deliveryDate: string | null; // YYYY-MM-DD
  deliveryType: string | null;
}

export interface RiskProductionSnapshot {
  estimatedMinutes: number | null;
  estimateApproximate: boolean;
  latestSafeStartAt: Date | null;
  deadlineAt: Date | null;
  startedAt: Date | null;
  readyPhotoRequired: boolean;
  photoAttached: boolean;
  checklistComplete: boolean | null; // null — чеклиста нет/не создан
}

export interface RiskCapacitySnapshot {
  /** null — кондитер не назначен / дата неизвестна → ёмкость не проверена. */
  fits: boolean | null;
  utilizationPercent: number | null;
}

export interface RiskInventorySnapshot {
  shortageCount: number;
}

export interface RiskInput {
  order: RiskOrderSnapshot;
  production: RiskProductionSnapshot;
  capacity: RiskCapacitySnapshot;
  inventory: RiskInventorySnapshot;
  /** Активный резерв есть (окно закреплено). */
  hasReservation: boolean;
  now?: Date;
}

export interface RiskResult {
  level: RiskLevel;
  reasons: RiskReasonCode[];
  /** Описания причин для UI (рус.). */
  details: string[];
}

const CANCELLED_STATUSES = new Set(["CANCELLED", "REFUNDED"]);
const DONE_STATUSES = new Set(["DELIVERED", "COMPLETED"]);

/**
 * Рассчитать риск заказа.
 * Порядок эскалации уровня: RED > ORANGE > YELLOW > GREEN.
 */
export function computeOrderRisk(input: RiskInput): RiskResult {
  const now = input.now ?? new Date();
  const reasons: RiskReasonCode[] = [];
  const details: string[] = [];

  const { order, production, capacity, inventory } = input;
  const cancelled = CANCELLED_STATUSES.has(order.status);
  const done = DONE_STATUSES.has(order.status);

  // --- Терминальные заказы не считаем рискованными ---
  if (cancelled || done) {
    return { level: "GREEN", reasons: [], details: [] };
  }

  // 1. PAYMENT_NOT_CONFIRMED (не оплачен и ещё не отменён)
  const paid = ["escrow", "succeeded", "released"].includes(order.paymentStatus);
  if (!paid) {
    reasons.push("PAYMENT_NOT_CONFIRMED");
    details.push("Оплата не подтверждена.");
  }

  // 2. NO_CONFECTIONER
  if (!order.confectionerId) {
    reasons.push("NO_CONFECTIONER");
    details.push("Кондитер не назначен.");
  }

  // 3. LOW_STOCK
  if (inventory.shortageCount > 0) {
    reasons.push("LOW_STOCK");
    details.push(`Дефицит ингредиентов: ${inventory.shortageCount} поз.`);
  }

  // 4. Окно производства не закреплено / ёмкость превышена (ТЗ §16, §27)
  if (order.confectionerId && !input.hasReservation && !done) {
    if (capacity.fits === false || (capacity.utilizationPercent !== null && capacity.utilizationPercent >= 100)) {
      reasons.push("CAPACITY_EXCEEDED");
      details.push(
        `Производственная загрузка ${capacity.utilizationPercent ?? "—"}%, свободного окна нет.`
      );
    } else {
      // Окно не закреплено (CAPACITY_NOT_RESERVED): ORANGE, если дедлайн
      // ближе 2 суток, иначе YELLOW.
      reasons.push("CAPACITY_NOT_RESERVED");
      details.push("Окно производства не закреплено (резерв отсутствует).");
    }
  }

  // 5. MISSING_PRODUCT_DATA (оценка времени — глобальный дефолт)
  if (production.estimateApproximate && production.estimatedMinutes === null) {
    reasons.push("MISSING_PRODUCT_DATA");
    details.push("Время производства не сконфигурировано (нет данных товара/рецепта).");
  }

  // 6. Deadline-логика: PRODUCTION_NOT_STARTED / DEADLINE_TOO_CLOSE
  if (production.latestSafeStartAt) {
    const margin = marginMinutes(production.latestSafeStartAt, now);
    const productionStarted = Boolean(production.startedAt) || order.status !== "PENDING" && ["PREPARING", "READY", "IN_DELIVERY"].includes(order.status);

    if (margin <= 0 && !productionStarted) {
      reasons.push("PRODUCTION_NOT_STARTED");
      details.push(
        "Безопасное время старта производства прошло, производство не начато."
      );
    } else if (margin <= RISK_ORANGE_MARGIN_MINUTES && !productionStarted) {
      reasons.push("PRODUCTION_NOT_STARTED");
      details.push(
        `До последнего безопасного старта осталось ${Math.max(margin, 0)} мин, производство не начато.`
      );
    }

    if (production.deadlineAt) {
      const toDeadline = marginMinutes(production.deadlineAt, now);
      if (toDeadline <= RISK_DEADLINE_TOO_CLOSE_MINUTES && !done) {
        reasons.push("DEADLINE_TOO_CLOSE");
        details.push(`Дедлайн ближе ${RISK_DEADLINE_TOO_CLOSE_MINUTES} мин.`);
      }
    }
  }

  // 7. DELIVERY_RISK: доставка назначена, но производство не готово (статус READY нужен до IN_DELIVERY)
  if (order.status === "IN_DELIVERY" && !production.checklistComplete) {
    reasons.push("DELIVERY_RISK");
    details.push("Доставка начата, чеклист производства не завершён.");
  }

  // 8. Фото готовности требуется, но не приложено и срок вышел
  if (
    production.readyPhotoRequired &&
    !production.photoAttached &&
    order.status === "PREPARING" &&
    production.latestSafeStartAt &&
    marginMinutes(production.latestSafeStartAt, now) <= 0
  ) {
    reasons.push("DEADLINE_TOO_CLOSE");
    details.push("Фото готовности не приложено, срок поджимает.");
  }

  // --- Уровень ---
  const level = pickLevel(reasons, input, now);

  // Дедуп причин с сохранением порядка
  const deduped = [...new Set(reasons)];
  return { level, reasons: deduped, details };
}

function pickLevel(
  reasons: RiskReasonCode[],
  input: RiskInput,
  now: Date
): RiskLevel {
  if (reasons.length === 0) return "GREEN";

  const hard = new Set<RiskReasonCode>([
    "PRODUCTION_NOT_STARTED",
    "CAPACITY_EXCEEDED",
    "NO_CONFECTIONER",
    "DELIVERY_RISK",
  ]);
  const hasHard = reasons.some((r) => hard.has(r));
  const hasPayment = reasons.includes("PAYMENT_NOT_CONFIRMED");
  const hasNotReserved = reasons.includes("CAPACITY_NOT_RESERVED");

  // Не оплачен → максимум YELLOW (заказ ещё не принят в работу).
  if (hasPayment && !hasHard) return "YELLOW";

  // Запас до latest safe start для тонкой градации
  let margin = Number.POSITIVE_INFINITY;
  if (input.production.latestSafeStartAt) {
    margin = marginMinutes(input.production.latestSafeStartAt, now);
  }

  if (hasHard) {
    if (margin <= 0) return "RED";
    if (margin <= RISK_ORANGE_MARGIN_MINUTES) return "RED";
    if (reasons.includes("CAPACITY_EXCEEDED")) return "ORANGE";
    return "ORANGE";
  }

  // Мягкие причины: LOW_STOCK / DEADLINE_TOO_CLOSE / MISSING_PRODUCT_DATA /
  // CAPACITY_NOT_RESERVED
  if (hasNotReserved) {
    // ORANGE только когда дедлайн ближе 2 суток (окно уже пора закрепить)
    if (
      input.production.deadlineAt &&
      input.production.deadlineAt.getTime() - now.getTime() <= 48 * 3_600_000
    ) {
      return "ORANGE";
    }
    return "YELLOW";
  }
  if (margin <= RISK_ORANGE_MARGIN_MINUTES) return "ORANGE";
  if (reasons.includes("LOW_STOCK")) return "ORANGE";
  return "YELLOW";
}

/**
 * Запас времени (минуты) до latest safe start для UI.
 * null — latest safe start не рассчитан.
 */
export function riskMarginMinutes(
  production: { latestSafeStartAt: Date | null },
  now: Date = new Date()
): number | null {
  if (!production.latestSafeStartAt) return null;
  return marginMinutes(production.latestSafeStartAt, now);
}
