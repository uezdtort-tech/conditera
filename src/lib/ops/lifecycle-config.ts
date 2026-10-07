/**
 * lifecycle-config.ts — единая конфигурация P0.5 «Order Lifecycle & Capacity Engine».
 *
 * ТЗ §15: веса matching score вынесены в конфигурацию, не зашиты по коду.
 * ТЗ §24: SLA-пороги эскалации конфигурируемы.
 * ТЗ §11: буферы (delivery/packaging/QC/handoff) конфигурируемы.
 * ТЗ §10: приоритет источника оценки времени производства.
 * ТЗ §18: шаблоны чеклистов по типу продукта.
 * ТЗ §35: категории, требующие фото готовности перед READY.
 *
 * Всё — чистые константы (детерминированная механика, ТЗ §54: без LLM).
 */

// ---------------------------------------------------------------------------
// Буферы Deadline Engine (минуты), ТЗ §11
// ---------------------------------------------------------------------------

export interface DeadlineBuffers {
  /** Буфер доставки: от дедлайна клиента назад. */
  deliveryBufferMinutes: number;
  /** Буфер передачи/хендовoff. */
  handoffBufferMinutes: number;
  /** Упаковка. */
  packagingMinutes: number;
  /** Контроль качества. */
  qualityCheckMinutes: number;
}

export const DEFAULT_DEADLINE_BUFFERS: DeadlineBuffers = {
  deliveryBufferMinutes: 30,
  handoffBufferMinutes: 15,
  packagingMinutes: 20,
  qualityCheckMinutes: 15,
};

// ---------------------------------------------------------------------------
// Ёмкость по умолчанию (если у кондитера нет строки confectioner_capacity)
// ---------------------------------------------------------------------------

/** 09:00 в минутах дня. */
export const DEFAULT_WORKDAY_START_MINUTE = 9 * 60;
/** 18:00 в минутах дня. */
export const DEFAULT_WORKDAY_END_MINUTE = 18 * 60;
/** Суммарная производственная ёмкость в день (минуты). */
export const DEFAULT_DAILY_CAPACITY_MINUTES = 8 * 60;

// ---------------------------------------------------------------------------
// Оценка времени производства (ТЗ §10)
// ---------------------------------------------------------------------------

export type EstimateSource = "product" | "recipe" | "category" | "manual" | "default";

/** Приоритет источников оценки: product/recipe → category → manual/config. */
export const ESTIMATE_SOURCE_PRIORITY: EstimateSource[] = [
  "product",
  "recipe",
  "category",
  "default",
];

/** Глобальный дефолт, если ничего не известно (минуты). Помечается как approximate. */
export const DEFAULT_PRODUCTION_MINUTES = 180;

/**
 * Категорийные дефолты (минуты производства на 1 заказ).
 * Ключ — slug категории товара (product_categories.slug).
 * Отсутствие категории в словаре → DEFAULT_PRODUCTION_MINUTES.
 */
export const CATEGORY_PRODUCTION_MINUTES: Record<string, number> = {
  cakes: 240,
  realistic_cakes: 300,
  bento: 180,
  cupcakes: 120,
  macarons: 150,
  pastries: 120,
  cookies: 90,
  gingerbread: 90,
  desserts: 90,
  pies: 150,
  patties: 120,
  rolls: 120,
  zephyr_bouquets: 120,
  pastila: 120,
  chocolate: 90,
  candies: 90,
  marmalade: 90,
  lollipops: 60,
  healthy: 90,
  oriental_sweets: 120,
};

// ---------------------------------------------------------------------------
// Deadline: если у заказа не указано время (ни окна, ни delivery_time) —
// считаем дедлайном этот час локального дня доставки.
// ---------------------------------------------------------------------------

export const DEFAULT_DELIVERY_DEADLINE_MINUTE = 18 * 60;

// ---------------------------------------------------------------------------
// Risk Engine (ТЗ §12)
// ---------------------------------------------------------------------------

export type RiskLevel = "GREEN" | "YELLOW" | "ORANGE" | "RED";

export type RiskReasonCode =
  | "LOW_STOCK"
  | "NO_CONFECTIONER"
  | "CAPACITY_EXCEEDED"
  | "CAPACITY_NOT_RESERVED"
  | "PRODUCTION_NOT_STARTED"
  | "DEADLINE_TOO_CLOSE"
  | "DELIVERY_RISK"
  | "PAYMENT_NOT_CONFIRMED"
  | "MISSING_PRODUCT_DATA";

/** Запас до latest safe start, при котором риск становится YELLOW (минуты). */
export const RISK_YELLOW_MARGIN_MINUTES = 180;
/** Запас, при котором риск становится ORANGE (минуты). */
export const RISK_ORANGE_MARGIN_MINUTES = 60;
/** Дедлайн ближе этого порога (минуты) → DEADLINE_TOO_CLOSE. */
export const RISK_DEADLINE_TOO_CLOSE_MINUTES = 120;

// ---------------------------------------------------------------------------
// Escalation SLA (ТЗ §24) — минуты, конфигурируемы
// ---------------------------------------------------------------------------

export const ESCALATION_CONFIG = {
  /** Заказ не назначен: первый порог — задача кондитеру/админу. */
  unassignedNotifyMinutes: 15,
  /** Не назначен: critical task. */
  unassignedCriticalMinutes: 30,
  /** Не назначен: admin escalation. */
  unassignedEscalationMinutes: 60,
  /** Production start missed → warning task ORDER_PRODUCTION_DELAYED. */
  productionStartMissedMinutes: 15,
  /** Дедлайн близко (до latest safe start < порога) → critical. */
  deadlineApproachingMinutes: 60,
} as const;

// ---------------------------------------------------------------------------
// Matching score (ТЗ §15) — веса в конфигурации
// ---------------------------------------------------------------------------

export interface MatchingWeights {
  capacity: number;
  availability: number;
  specialization: number;
  inventoryProximity: number;
  distance: number;
  rating: number;
  price: number;
}

export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  capacity: 30,
  availability: 25,
  specialization: 20,
  inventoryProximity: 10,
  distance: 5,
  rating: 5,
  price: 5,
};

// ---------------------------------------------------------------------------
// Производственные чеклисты (ТЗ §18) — набор этапов зависит от типа продукта
// ---------------------------------------------------------------------------

export interface ChecklistStageTemplate {
  key: string;
  label: string;
}

/** Базовый «тортовый» конвейер. */
const CAKE_STAGES: ChecklistStageTemplate[] = [
  { key: "ingredients_prepared", label: "Подготовка ингредиентов" },
  { key: "baking", label: "Выпечка" },
  { key: "cooling", label: "Охлаждение" },
  { key: "filling", label: "Крем/начинка" },
  { key: "assembly", label: "Сборка" },
  { key: "decoration", label: "Декор" },
  { key: "quality_check", label: "Контроль качества" },
  { key: "packaging", label: "Упаковка" },
  { key: "ready_photo", label: "Фото готовности" },
  { key: "handoff", label: "Передача" },
];

const CUPCAKE_STAGES: ChecklistStageTemplate[] = [
  { key: "ingredients_prepared", label: "Подготовка ингредиентов" },
  { key: "baking", label: "Выпечка" },
  { key: "cooling", label: "Охлаждение" },
  { key: "filling", label: "Крем/начинка" },
  { key: "decoration", label: "Декор" },
  { key: "quality_check", label: "Контроль качества" },
  { key: "packaging", label: "Упаковка" },
  { key: "ready_photo", label: "Фото готовности" },
  { key: "handoff", label: "Передача" },
];

const COOKIE_STAGES: ChecklistStageTemplate[] = [
  { key: "ingredients_prepared", label: "Подготовка ингредиентов" },
  { key: "baking", label: "Выпечка" },
  { key: "cooling", label: "Охлаждение" },
  { key: "decoration", label: "Декор" },
  { key: "quality_check", label: "Контроль качества" },
  { key: "packaging", label: "Упаковка" },
  { key: "handoff", label: "Передача" },
];

const DESSERT_SET_STAGES: ChecklistStageTemplate[] = [
  { key: "ingredients_prepared", label: "Подготовка ингредиентов" },
  { key: "filling", label: "Крем/начинка" },
  { key: "assembly", label: "Сборка набора" },
  { key: "quality_check", label: "Контроль качества" },
  { key: "packaging", label: "Упаковка" },
  { key: "ready_photo", label: "Фото готовности" },
  { key: "handoff", label: "Передача" },
];

/**
 * Выбор шаблона по категории товара (slug). Порядок ВАЖЕН:
 * первый совпавший ключ побеждает (realistic_cakes до cakes и т.п.).
 */
export const CHECKLIST_TEMPLATES: Array<{
  matchCategories: string[];
  stages: ChecklistStageTemplate[];
}> = [
  { matchCategories: ["realistic_cakes"], stages: CAKE_STAGES },
  { matchCategories: ["cakes", "bento"], stages: CAKE_STAGES },
  { matchCategories: ["cupcakes", "macarons"], stages: CUPCAKE_STAGES },
  { matchCategories: ["cookies", "gingerbread", "lollipops"], stages: COOKIE_STAGES },
  {
    matchCategories: [
      "desserts",
      "zephyr_bouquets",
      "pastila",
      "candies",
      "marmalade",
      "chocolate",
      "oriental_sweets",
      "healthy",
    ],
    stages: DESSERT_SET_STAGES,
  },
  {
    matchCategories: ["pastries", "pies", "patties", "rolls"],
    stages: CUPCAKE_STAGES,
  },
];

/** Чеклист по умолчанию (категория не распознана). */
export const DEFAULT_CHECKLIST_STAGES: ChecklistStageTemplate[] = CAKE_STAGES;

/** Выбрать шаблон чеклиста по slug категории. */
export function checklistTemplateForCategory(
  categorySlug: string | null | undefined
): ChecklistStageTemplate[] {
  if (!categorySlug) return DEFAULT_CHECKLIST_STAGES;
  const slug = categorySlug.trim().toLowerCase();
  for (const tpl of CHECKLIST_TEMPLATES) {
    if (tpl.matchCategories.includes(slug)) return tpl.stages;
  }
  return DEFAULT_CHECKLIST_STAGES;
}

// ---------------------------------------------------------------------------
// Ready photo gate (ТЗ §35): категории, требующие фото готовности
// ---------------------------------------------------------------------------

export const READY_PHOTO_REQUIRED_CATEGORIES: ReadonlySet<string> = new Set([
  "cakes",
  "realistic_cakes",
  "bento",
]);

export function readyPhotoRequiredForCategory(
  categorySlug: string | null | undefined
): boolean {
  if (!categorySlug) return false;
  return READY_PHOTO_REQUIRED_CATEGORIES.has(categorySlug.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Timeline: этап → минутные офсеты для визуального плана (ТЗ §17)
// Раскладка выполняется от planned_start; доли от estimated_minutes.
// ---------------------------------------------------------------------------

export const PLAN_STAGE_SHARES: Record<string, number> = {
  ingredients_prepared: 0.1,
  baking: 0.3,
  cooling: 0.15,
  filling: 0.15,
  assembly: 0.15,
  decoration: 0.1,
  quality_check: 0.05,
  packaging: 0.05,
  ready_photo: 0.02,
  handoff: 0.03,
};

// ---------------------------------------------------------------------------
// Risk → ops task / уведомления (ТЗ §33): не уведомляем на каждом recalc —
// только смены уровня риска обрабатывает rule engine (dedup по dedup_key).
// ---------------------------------------------------------------------------

/** Уровни риска, которые материализуются в ops-задачи ORDER_AT_RISK. */
export const RISK_TASK_LEVELS: ReadonlySet<RiskLevel> = new Set<RiskLevel>(["ORANGE", "RED"]);
