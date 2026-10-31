/**
 * analytics-compute.ts — чистые функции аналитики кондитера из реальных заказов.
 *
 * Заменяет hardcoded CONFECTIONER_ANALYTICS (src/lib/mock-data.ts) вычислениями
 * на данных GET /api/orders (см. use-real-orders.ts, сервер скоупит по роли).
 *
 * Контракты (задокументированные решения):
 *  - computeMonthlyRevenue: учитываются ТОЛЬКО COMPLETED-заказы (выручка = сумма
 *    order.total, без вычета комиссии — комиссия показывается отдельно в финансах).
 *    Окно = последние N месяцев, включая текущий; нулевые месяцы присутствуют в
 *    результате. Месяцы после `now` (будущие) и до окна — пропускаются. Битые/
 *    отсутствующие даты — пропуск строки. null/NaN total трактуется как 0.
 *    Бакетинг по UTC-месяцу createdAt ('YYYY-MM') — детерминированно на сервере
 *    и клиенте независимо от таймзоны браузера.
 *  - computeOrdersByStatus: возвращает ТОЛЬКО статусы, реально встречающиеся в
 *    данных (пи-чарт с нулевыми секторами нечитаем; отсутствие сектора = честный
 *    сигнал «заказов такого статуса нет»). Сортировка: count desc, при равенстве —
 *    статус по алфавиту.
 *  - computeTopProducts: агрегация по названию товара (order_items.title);
 *    count = суммарное количество единиц (Σ quantity, qty <= 0 / отсутствует → 1);
 *    revenue = Σ(price × qty) — тот же total, что платит покупатель за позицию.
 *    Позиции без названия пропускаются. Ограничение `limit` по убыванию count.
 */
import type { Order, OrderStatus } from "@/lib/types";

export interface MonthlyRevenuePoint {
  /** Человекочитаемая подпись месяца, напр. «Янв» */
  label: string;
  /** ISO-месяц 'YYYY-MM' (UTC по createdAt) */
  month: string;
  /** Сумма order.total COMPLETED-заказов за месяц */
  revenue: number;
}

export interface OrdersByStatusPoint {
  status: OrderStatus;
  count: number;
}

export interface TopProductPoint {
  /** Название товара (order_items.title) */
  name: string;
  /** Суммарное количество проданных единиц */
  count: number;
  /** Выручка по позиции: Σ(price × qty) */
  revenue: number;
}

const RU_MONTHS_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
] as const;

/** ISO-месяц 'YYYY-MM' из значения даты; null — если дата отсутствует/невалидна */
function isoMonthOf(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 7);
}

/** total заказа: null/undefined/NaN → 0 */
function safeTotal(order: Order): number {
  const t = Number(order?.total);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Выручка по месяцам за последние `months` месяцев (включая текущий).
 * Только COMPLETED; нулевые месяцы включаются; будущие месяцы пропускаются.
 */
export function computeMonthlyRevenue(
  orders: Order[] | null | undefined,
  months = 6,
  now: Date = new Date()
): MonthlyRevenuePoint[] {
  if (!orders) return []; // null/undefined входа → нет данных
  const n = Math.max(0, Math.floor(months));
  const nowMonth = isoMonthOf(now);
  if (!nowMonth) return [];

  // Окно: n месяцев назад … текущий месяц (хронологический порядок)
  const [nowYear, nowMonthIdx] = nowMonth.split("-").map(Number);
  const window: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    window.push(new Date(Date.UTC(nowYear, nowMonthIdx - 1 - i, 1)).toISOString().slice(0, 7));
  }

  const buckets = new Map<string, number>(window.map((m) => [m, 0]));
  for (const order of orders ?? []) {
    if (!order || order.status !== "COMPLETED") continue;
    const month = isoMonthOf(order.createdAt);
    if (!month || !buckets.has(month)) continue; // битая дата / вне окна / будущий месяц
    buckets.set(month, buckets.get(month)! + safeTotal(order));
  }

  return window.map((month) => {
    const monthIdx = Number(month.slice(5, 7)) - 1;
    return {
      label: RU_MONTHS_SHORT[monthIdx] ?? month,
      month,
      revenue: buckets.get(month) ?? 0,
    };
  });
}

/**
 * Количество заказов по статусам. Включает ТОЛЬКО статусы, присутствующие во
 * входных данных (нулевых секторов нет — см. контракт в шапке файла).
 */
export function computeOrdersByStatus(
  orders: Order[] | null | undefined
): OrdersByStatusPoint[] {
  const counts = new Map<OrderStatus, number>();
  for (const order of orders ?? []) {
    if (!order?.status) continue;
    const status = order.status;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

/**
 * Топ товаров по названию из order_items. count = Σ quantity (qty <= 0 → 1),
 * revenue = Σ(price × qty). Позиции без названия пропускаются. Сортировка:
 * count desc → revenue desc → имя по алфавиту; результат ограничен `limit`.
 */
export function computeTopProducts(
  orders: Order[] | null | undefined,
  limit = 5
): TopProductPoint[] {
  const agg = new Map<string, TopProductPoint>();
  for (const order of orders ?? []) {
    if (!order) continue;
    for (const item of order.items ?? []) {
      const name = typeof item?.title === "string" ? item.title.trim() : "";
      if (!name) continue;
      const rawQty = Number(item?.quantity);
      const units = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
      const rawPrice = Number(item?.price);
      const price = Number.isFinite(rawPrice) ? rawPrice : 0;
      const row = agg.get(name) ?? { name, count: 0, revenue: 0 };
      row.count += units;
      row.revenue += price * units;
      agg.set(name, row);
    }
  }
  return Array.from(agg.values())
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, Math.floor(limit)));
}

/**
 * Мета для графиков статусов: ru-подпись + fill-цвет (oklch) для recharts Cell.
 * Цвета согласованы с палитрой проекта (тёплые/зелёные/фиолетовые, без blue).
 */
export const STATUS_CHART_META: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Новые", color: "oklch(0.55 0.18 25)" },
  NEGOTIATING: { label: "Согласование", color: "oklch(0.75 0.10 95)" },
  CONFIRMED: { label: "Подтверждены", color: "oklch(0.65 0.12 55)" },
  PREPARING: { label: "Готовятся", color: "oklch(0.60 0.12 305)" },
  IN_PROGRESS: { label: "В работе", color: "oklch(0.70 0.14 70)" },
  READY: { label: "Готовы", color: "oklch(0.65 0.10 145)" },
  IN_DELIVERY: { label: "В доставке", color: "oklch(0.72 0.13 195)" },
  DELIVERED: { label: "Доставлены", color: "oklch(0.68 0.10 165)" },
  DELIVERING: { label: "Доставляются", color: "oklch(0.78 0.16 80)" },
  COMPLETED: { label: "Завершены", color: "oklch(0.55 0.12 305)" },
  CANCELLED: { label: "Отменены", color: "oklch(0.40 0.12 30)" },
  DISPUTE: { label: "Спор", color: "oklch(0.60 0.16 45)" },
  REFUNDED: { label: "Возвращены", color: "oklch(0.50 0.14 15)" },
};
