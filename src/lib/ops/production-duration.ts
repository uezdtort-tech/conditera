/**
 * production-duration.ts — оценка времени производства заказа (ТЗ §10).
 *
 * Разделяет два разных понятия:
 *   - products.production_time_hours — срок от заказа до выдачи (lead time);
 *     он проверяется относительно дедлайна, но НЕ является трудоёмкостью
 *     одного рабочего окна.
 *   - recipes.prep_time_minutes + cook_time_minutes — фактическая трудоёмкость
 *     для capacity и latest-safe-start.
 *
 * Для capacity приоритет источников:
 *   1. recipe.prep_time_minutes + cook_time_minutes («configured»)
 *   2. category default (словарь в lifecycle-config, «estimated»)
 *   3. глобальный default («estimated»)
 *
 * Система ЯВНО показывает source и approximate (ТЗ §10: не выдавать
 * приблизительное значение как точное).
 */

import {
  CATEGORY_PRODUCTION_MINUTES,
  DEFAULT_PRODUCTION_MINUTES,
  type EstimateSource,
} from "./lifecycle-config";

export interface ProductionTimeInput {
  /** products.production_time_hours (lead time в часах). */
  productProductionTimeHours: number | null;
  /** recipes.prep_time_minutes. */
  recipePrepMinutes: number | null;
  /** recipes.cook_time_minutes. */
  recipeCookMinutes: number | null;
  /** products.category → product_categories.slug. */
  categorySlug: string | null;
}

export interface ProductionTimeEstimate {
  minutes: number;
  source: EstimateSource;
  /** true — оценка (category/default), false — сконфигурированное значение. */
  approximate: boolean;
}

/**
 * Оценка для ОДНОЙ позиции товара.
 * product.production_time_hours — это lead time (часы, ≥0.25h осмысленно);
 * recipe.prep+cook — чистое производственное время в минутах.
 */
export function estimateItemProductionMinutes(
  input: ProductionTimeInput
): ProductionTimeEstimate {
  // productProductionTimeHours — lead time от заказа до выдачи,
  // а не непрерывная занятость кондитера. Для capacity используем только
  // активное время рецепта; lead time проверяется отдельно в Acceptance Engine.
  // 1. Рецепт: prep + cook
  const prep = input.recipePrepMinutes;
  const cook = input.recipeCookMinutes;
  if ((prep !== null && prep > 0) || (cook !== null && cook > 0)) {
    const total = Math.max(0, prep ?? 0) + Math.max(0, cook ?? 0);
    if (total > 0) {
      return { minutes: Math.round(total), source: "recipe", approximate: false };
    }
  }

  // 2. Категорийный дефолт
  if (input.categorySlug) {
    const slug = input.categorySlug.trim().toLowerCase();
    const cat = CATEGORY_PRODUCTION_MINUTES[slug];
    if (cat) return { minutes: cat, source: "category", approximate: true };
  }

  // 3. Глобальный дефолт
  return {
    minutes: DEFAULT_PRODUCTION_MINUTES,
    source: "default",
    approximate: true,
  };
}

/** Проверка минимального срока от оформления заказа до выдачи. */
export function isDeliveryLeadTimeSatisfied(
  productProductionTimeHours: number | null,
  deadlineAt: Date | null,
  now: Date = new Date()
): boolean {
  if (
    !deadlineAt ||
    productProductionTimeHours === null ||
    !Number.isFinite(productProductionTimeHours) ||
    productProductionTimeHours <= 0
  ) {
    return true;
  }
  const requiredReadyAt = now.getTime() + productProductionTimeHours * 60 * 60 * 1000;
  return deadlineAt.getTime() >= requiredReadyAt;
}

export interface OrderItemForEstimate {
  quantity: number;
  time: ProductionTimeInput | null;
}

/**
 * Оценка времени производства ЗАКАЗА:
 * max по позициям (позиции могут производиться последовательно/параллельно —
 * консервативно берём самый долгий конвейер × количество партий не считаем:
 * суммарный объём позиций одного товара отражает quantity, но производственный
 * конвейер обычно пакетный; для P0.5 — max(позиции) — детерминированно и
 * документировано).
 */
export function estimateOrderProductionMinutes(
  items: OrderItemForEstimate[]
): ProductionTimeEstimate {
  let best: ProductionTimeEstimate | null = null;

  for (const item of items) {
    const qty = Math.max(1, Math.min(Math.round(item.quantity ?? 1), 999));
    // Крупные партии одного товара: добавляем 20% за каждые полные 5 единиц
    // сверх первой (нелинейный, но детерминированный коэффициент партии).
    if (!item.time) continue;
    const per = estimateItemProductionMinutes(item.time);
    const batchFactor = 1 + Math.floor((qty - 1) / 5) * 0.2;
    const minutes = Math.round(per.minutes * batchFactor);
    const candidate: ProductionTimeEstimate = {
      minutes,
      source: per.source,
      approximate: per.approximate,
    };
    if (!best || candidate.minutes > best.minutes) best = candidate;
  }

  return (
    best ?? {
      minutes: DEFAULT_PRODUCTION_MINUTES,
      source: "default",
      approximate: true,
    }
  );
}

/**
 * Проверка полноты конфигурации товара (ТЗ §30):
 * «Product configuration incomplete. Production time is missing.»
 * Возвращает true, если ни product, ни recipe не дают времени —
 * значит используется категорийный/глобальный дефолт (approximate).
 */
export function isProductTimeMissing(
  input: ProductionTimeInput | null | undefined
): boolean {
  if (!input) return true;
  const hasProduct = input.productProductionTimeHours != null && input.productProductionTimeHours > 0;
  const hasRecipe =
    (input.recipePrepMinutes != null && input.recipePrepMinutes > 0) ||
    (input.recipeCookMinutes != null && input.recipeCookMinutes > 0);
  return !hasProduct && !hasRecipe;
}
