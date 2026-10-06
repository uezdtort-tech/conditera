/**
 * ops-client-types.ts — типы клиентских контрактов операционного центра (Task 3).
 *
 * Файл описывает ТОЛЬКО клиентскую сторону (то, что отдают UI-компоненты):
 *   • /api/ops/tasks            — очередь задач (админ + кондитер)
 *   • /api/ops/summary          — сводка дня для админа
 *   • /api/ops/confectioner-today — «Сегодня» кондитера
 *   • /api/orders/{id}/breakdown  — разбор заказа по ингредиентам
 *   • /api/orders/{id}/purchase-draft — черновик закупки из дефицита
 *   • /api/products/{id}/completeness — готовность карточки товара
 *
 * НЕ редактировать src/lib/types.ts — легаси-типы маркетплейса остаются как есть.
 */

// ==================== /api/ops/tasks ====================

export type OpsSeverity = "critical" | "important" | "info";

/** Задача операционной очереди (snake_case, как в БД ops_tasks). */
export interface OpsTask {
  id: string;
  dedup_key: string;
  type: string;
  severity: OpsSeverity;
  title: string;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  assignee_role: string | null;
  /** Произвольные детали: { total?: number; orderNumber?: string; ... } */
  payload: Record<string, unknown> | null;
  action_label: string | null;
  /** Например "/dashboard?tab=orders" — тогда UI переключает таб дашборда. */
  action_url: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
}

export interface OpsTaskCounts {
  critical: number;
  important: number;
  info: number;
}

export interface OpsTasksResponse {
  tasks: OpsTask[];
  counts: OpsTaskCounts;
  scannedAt: string;
}

export interface OpsTaskActionBody {
  action: "resolve" | "dismiss";
  comment?: string;
}

// ==================== /api/ops/summary ====================

export interface OpsSummaryResponse {
  generatedAt: string;
  today: {
    orders: number;
    inProduction: number;
    deliveries: number;
    newCustomers: number;
    revenueToday: number | null;
    revenueMonth: number | null;
  };
  attention: OpsTaskCounts;
  system: {
    db: "ok" | "fail";
    payments: { configured: boolean };
    automation: { configured: boolean };
    /** Контракт свободный — рендерим по наличию/полю ok. */
    storage: unknown;
  };
}

// ==================== /api/ops/confectioner-today ====================

export interface ConfectionerTodayOrder {
  id: string;
  number: string;
  status: string;
  delivery_time: string | null;
  delivery_time_window: string | null;
  total: number;
  items_count: number;
  product_titles: string[];
}

export interface ConfectionerLowStockItem {
  id: string;
  name: string;
  quantity: number;
  min_quantity: number;
  unit: string;
}

/** source: low_stock_auto | order | manual */
export interface ConfectionerPurchaseDraft {
  id: string;
  status: string;
  source: string;
  items_count: number;
  total_estimated: number;
}

export interface ConfectionerTodayResponse {
  scannedAt: string;
  tasks: { counts: OpsTaskCounts; items: OpsTask[] };
  ordersToday: ConfectionerTodayOrder[];
  inProduction: ConfectionerTodayOrder[];
  lowStock: ConfectionerLowStockItem[];
  purchaseDrafts: ConfectionerPurchaseDraft[];
  revenueToday: number | null;
  messagesUnread: number;
}

// ==================== /api/orders/{id}/breakdown ====================

export type BreakdownIngredientStatus = "ok" | "shortage" | "no_stock" | "unit_mismatch";

export interface BreakdownIngredient {
  name: string;
  unit: string;
  required: number;
  stock: number;
  status: BreakdownIngredientStatus;
  inventory_item_id: string | null;
  estimated_cost: number;
}

export interface OrderBreakdownResponse {
  order: {
    id: string;
    number: string;
    status: string;
    delivery_date: string;
    confectioner_id: string | null;
  };
  items: { product_id: string; title: string; quantity: number; recipe_id: string | null }[];
  ingredients: BreakdownIngredient[];
  shortages: BreakdownIngredient[];
  can_produce: boolean;
  total_shortage_cost: number;
}

export interface PurchaseDraft {
  id: string;
  status: string;
  source: string;
  note: string | null;
}

export interface PurchaseDraftItem {
  name: string;
  quantity: number;
  unit: string;
  estimated_cost: number;
}

export interface PurchaseDraftResponse {
  draft: PurchaseDraft;
  items: PurchaseDraftItem[];
}

// ==================== /api/products/{id}/completeness ====================

export interface ProductCompletenessCheck {
  key: string;
  label: string;
  done: boolean;
  weight: number;
  required: boolean;
}

export interface ProductCompletenessResponse {
  score: number;
  ready_to_publish: boolean;
  checks: ProductCompletenessCheck[];
}

// ==================== UI-хелперы ====================

/** ru-RU форматирование денег: 12 500 ₽ */
export function formatRub(n: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(n))} ₽`;
}

/** Цветовая схема severity: critical→red, important→amber, info→slate (НЕ синий). */
export const SEVERITY_UI: Record<
  OpsSeverity,
  { label: string; emoji: string; dot: string; text: string; border: string; bg: string }
> = {
  critical: {
    label: "Критические",
    emoji: "🔴",
    dot: "bg-red-500",
    text: "text-red-700",
    border: "border-red-200",
    bg: "bg-red-50",
  },
  important: {
    label: "Важные",
    emoji: "🟠",
    dot: "bg-amber-500",
    text: "text-amber-700",
    border: "border-amber-200",
    bg: "bg-amber-50",
  },
  info: {
    label: "Информационные",
    emoji: "🔵",
    dot: "bg-slate-400",
    text: "text-slate-600",
    border: "border-slate-200",
    bg: "bg-slate-50",
  },
};

/** Метка источника черновика закупки. */
export function purchaseDraftSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "low_stock_auto":
      return "Авто (низкий остаток)";
    case "order":
      return "По заказу";
    case "manual":
      return "Вручную";
    default:
      return source || "—";
  }
}

/** Детали из payload задачи (total ₽ / orderNumber) + прочие скаляры. */
export function extractPayloadInfo(payload: Record<string, unknown> | null): {
  total?: number;
  orderNumber?: string;
  extras: { key: string; value: string }[];
} {
  const extras: { key: string; value: string }[] = [];
  if (!payload || typeof payload !== "object") return { extras };
  let total: number | undefined;
  let orderNumber: string | undefined;
  for (const [rawKey, value] of Object.entries(payload)) {
    const key = rawKey.toLowerCase();
    if (key === "total" && typeof value === "number") {
      total = value;
      continue;
    }
    if ((key === "ordernumber" || key === "order_number" || key === "number") && typeof value === "string") {
      orderNumber = value;
      continue;
    }
    if (value == null) continue;
    if (typeof value === "string" && value.trim()) {
      extras.push({ key: rawKey, value: value.trim() });
    } else if (typeof value === "number" || typeof value === "boolean") {
      extras.push({ key: rawKey, value: String(value) });
    }
  }
  return { total, orderNumber, extras: extras.slice(0, 3) };
}
