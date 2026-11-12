/**
 * price-shared.ts — общие утилиты PR-1B (API истории цен, миграция 0083).
 *
 * Единицы денег: INTEGER РУБЛИ (identity-решение 0034; копейки только для
 * service_products/refunds). Часовой пояс даты-без-времени: цех
 * (workshop) — константа Europe/Moscow (UTC+03:00, летнее время отменено
 * с 2014 г. — фиксированный офсет, безопасно захардкожен строкой '+03:00').
 */

import { convertQty } from "@/lib/ops/units";

/** Минимальный контракт pg.Pool, нужный хелперам (мокается в тестах). */
export interface PgQueryer {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** Pool с пиннингом клиента — для multi-statement транзакций. */
export interface PoolWithConnect extends PgQueryer {
  connect: () => Promise<PgQueryer & { release: (e?: unknown) => void }>;
}

/**
 * Транзакция на закреплённом клиенте (pool.query('BEGIN') НЕ закрепляет
 * соединение — между BEGIN и COMMIT может прийти другой client из пула).
 */
export async function withTransaction<T>(
  pool: PoolWithConnect,
  fn: (client: PgQueryer) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* соединение уже умерло — release ниже */
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductAccess =
  | { ok: true; product: { id: string; confectioner_id: string } }
  | { ok: false; status: 400 | 404 | 403; error: string };

/**
 * Auth-контракт PR-1B (зеркало ownership-check в products/[id] PATCH):
 *   • id не UUID → 400; товара нет или soft-deleted → 404 (существование не
 *     раскрываем тем, кто не имеет к нему доступа);
 *   • не владелец (products.confectioner_id !== user.id) и не ADMIN/SUPER_ADMIN → 403.
 */
export async function authorizeProductAccess(
  db: PgQueryer,
  productId: string | undefined,
  userId: string,
  admin: boolean
): Promise<ProductAccess> {
  if (!productId || productId.length > 200 || !UUID_RE.test(productId)) {
    return { ok: false, status: 400, error: "Некорректный идентификатор товара" };
  }
  const res = await db.query(
    `SELECT id, confectioner_id FROM public.products WHERE id = $1 AND deleted_at IS NULL`,
    [productId]
  );
  const product = res.rows[0] as { id: string; confectioner_id: string } | undefined;
  if (!product) {
    return { ok: false, status: 404, error: "Товар не найден" };
  }
  if (product.confectioner_id !== userId && !admin) {
    return { ok: false, status: 403, error: "Доступ запрещён: только владелец товара или администратор" };
  }
  return { ok: true, product };
}

/** Workshop timezone: Europe/Moscow (UTC+03:00, без DST). */
export const WORKSHOP_TZ_OFFSET = "+03:00";
export const WORKSHOP_TZ_LABEL = "Europe/Moscow";

/** Причины изменения цены из CHECK 0083; 'initial' ставит только сид/функция. */
export const PRICE_REASONS = [
  "ingredients",
  "packaging",
  "decor",
  "logistics",
  "fuel",
  "electricity",
  "labor",
  "composition_change",
  "other",
] as const;

/** Полный enum CHECK 0083 (включая 'initial') — для admin-коррекций. */
export const ALL_PRICE_REASONS = ["initial", ...PRICE_REASONS] as const;

export type PriceReason = (typeof ALL_PRICE_REASONS)[number];

export function isPriceReason(value: unknown): value is PriceReason {
  return typeof value === "string" && (ALL_PRICE_REASONS as readonly string[]).includes(value);
}

/** Лимиты цены: int RUB, 0..10 000 000 (согласовано с валидацией карточки). */
export const PRICE_MAX_RUB = 10_000_000;

/**
 * Разбор даты для effective_from / price-at.
 *
 * Форматы:
 *   • "YYYY-MM-DD" — дата без времени; интерпретируется в workshop-часовом поясе
 *     Europe/Moscow (константа, см. WORKSHOP_TZ_OFFSET): time = "00:00" (граница
 *     версии цены) или "12:00" (полдень — для «цена на дату»).
 *   • полный ISO 8601 (Date.parse валиден, содержит время/офсет/UTC) — как есть.
 *
 * Неверная дата → null (route отвечает 400).
 */
export function parsePriceDate(
  raw: unknown,
  dateOnlyTime: "00:00" | "12:00"
): Date | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 64) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const ms = Date.parse(`${y}-${m}-${d}T${dateOnlyTime}:00${WORKSHOP_TZ_OFFSET}`);
    return Number.isNaN(ms) ? null : new Date(ms);
  }

  // Полный ISO: должен содержать время (T или пробел) — "2026-01-02" уже пойман выше.
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  // Отклоняем строки без указания времени (например "Jan 2026") — только строгий ISO.
  if (!/T|\s\d{2}:/.test(value)) return null;
  return new Date(ms);
}

/** Округление до 1 знака (deltaPercent / marginPercent). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Процент изменения цены: (next - prev)/prev * 100, округлённо до 0.1.
 * prev отсутствует или 0 → null (честно: деление на ноль не выдумываем).
 */
export function deltaPercent(next: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev === 0) return null;
  return round1(((next - prev) / prev) * 100);
}

// ============================================================================
// Себестоимость: recipe_ingredients × inventory_items.cost_per_unit
// ============================================================================

export interface RecipeCostResult {
  available: boolean;
  amountRub: number | null;
  /** Причина недоступности (когда available=false). */
  reason?: string;
  approximate: true;
  basis: "recipe_ingredients × current inventory cost_per_unit";
}

/**
 * Приблизительная себестоимость товара по привязанному рецепту:
 *   products.recipe_id → recipe_ingredients (qty, unit) →
 *   convertQty(qty, ingredient.unit → inventory_items.unit) × cost_per_unit.
 *
 * Честность: результат ВСЕГДА approximate=true. Ингредиент без складской
 * позиции / с несовместимыми единицами (convertQty → null) пропускается;
 * если ни одна позиция не оценена — available:false с reason (не выдумываем 0).
 * Ошибки БД отдаёт наверх — route оборачивает в try/catch → null.
 */
export async function computeRecipeCost(
  db: PgQueryer,
  productId: string
): Promise<RecipeCostResult> {
  const basis: RecipeCostResult["basis"] =
    "recipe_ingredients × current inventory cost_per_unit";

  const prodRes = await db.query(
    `SELECT recipe_id FROM public.products WHERE id = $1`,
    [productId]
  );
  const product = prodRes.rows[0] as { recipe_id: string | null } | undefined;
  if (!product) {
    return { available: false, amountRub: null, reason: "product not found", approximate: true, basis };
  }
  if (!product.recipe_id) {
    return { available: false, amountRub: null, reason: "у товара нет привязанного рецепта", approximate: true, basis };
  }

  const ingRes = await db.query(
    `SELECT ri.qty, ri.unit, ii.cost_per_unit, ii.unit AS inventory_unit
       FROM public.recipe_ingredients ri
       LEFT JOIN public.inventory_items ii ON ii.id = ri.inventory_item_id
      WHERE ri.recipe_id = $1`,
    [product.recipe_id]
  );
  const rows = ingRes.rows as Array<{
    qty: string | number;
    unit: string | null;
    cost_per_unit: number | null;
    inventory_unit: string | null;
  }>;

  if (rows.length === 0) {
    return { available: false, amountRub: null, reason: "рецепт без ингредиентов", approximate: true, basis };
  }

  let total = 0;
  let pricedCount = 0;
  for (const row of rows) {
    const qty = typeof row.qty === "string" ? Number(row.qty) : row.qty;
    const costPerUnit = row.cost_per_unit;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (costPerUnit === null || costPerUnit === undefined || !Number.isFinite(costPerUnit)) continue;
    // convertQty: qty в единице ингредиента → единицу склада (г↔кг, мл↔л, шт, дес).
    // Несовместимые/неизвестные единицы → null → позиция пропускается (best-effort).
    const converted =
      row.unit && row.inventory_unit ? convertQty(qty, row.unit, row.inventory_unit) : null;
    if (converted === null) continue;
    // Стоимость приводим к рублям за базовую единицу «в штуках позиции склада».
    total += converted * costPerUnit;
    pricedCount += 1;
  }

  if (pricedCount === 0) {
    return {
      available: false,
      amountRub: null,
      reason: "ни один ингредиент не удалось оценить (нет складских позиций или несовместимые единицы)",
      approximate: true,
      basis,
    };
  }

  return {
    available: true,
    amountRub: Math.round(total),
    approximate: true,
    basis,
  };
}

/**
 * Снимок себестоимости для записи в product_price_history.cost_snapshot_rub:
 * best-effort — любая ошибка → null (не блокирует установку цены).
 */
export async function computeCostSnapshotOrNull(
  db: PgQueryer,
  productId: string
): Promise<number | null> {
  try {
    const cost = await computeRecipeCost(db, productId);
    return cost.available ? cost.amountRub : null;
  } catch {
    return null;
  }
}
