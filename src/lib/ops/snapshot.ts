/**
 * snapshot.ts — неизменяемый snapshot производственной потребности заказа
 * (Z-v29, вариант A из Z-v28 §9.5: orders.metadata.acceptance_snapshot).
 *
 * ПРОБЛЕМА (Z-v27 P2 / Z-v28 §9): товарный заказ не фиксирует состав рецепта.
 * order_items снапшотит только коммерческие поля (title/price/qty), а потребность
 * в ингредиентах каждый раз вычисляется по ТЕКУЩЕМУ рецепту
 * (order_items → products.recipe_id → recipe_ingredients). Правка рецепта
 * задним числом меняет разбор/приёмку уже оплаченного заказа (409 canProduce).
 *
 * РЕШЕНИЕ: при создании заказа сервер собирает snapshot потребности (норма на
 * 1 единицу товара × количество, единицы, привязка к inventory_item_id) и
 * записывает его В ТОЙ ЖЕ строке orders (metadata.acceptance_snapshot) —
 * запись атомарна с созданием заказа. Acceptance/breakdown/закупка читают
 * потребность ИЗ snapshot; склад (остатки) остаётся «живым». Правка рецепта
 * после оформления меняет только НОВЫЕ заказы.
 *
 * КОНТРАКТ:
 *  • snapshot создаёт ТОЛЬКО сервер (checkout / POST /api/orders); тело запроса
 *    не содержит поля snapshot — клиент не может передать доверенный состав;
 *  • после фиксации snapshot не изменяется (ни один код-путь не пишет
 *    orders.metadata после INSERT — проверено Z-v29 grep по всем .update("orders"));
 *  • повторный checkout с тем же Idempotency-Key возвращает существующий заказ
 *    (replay) — второй несовместимый snapshot не создаётся; гонка 23505
 *    (индекс 0060) тоже завершается replay существующей строки;
 *  • snapshot хранит ИСХОДНЫЕ единицы рецепта; конвертация выполняется при
 *    расчёте той же convertQty (src/lib/ops/units.ts) — несовместимые единицы
 *    по-прежнему дают unit_mismatch (fail-closed), неявных пересчётов нет;
 *  • повреждённый/частичный snapshot с неизвестной schema_version —
 *    fail-closed (SNAPSHOT_INVALID), а не молчаливый откат к текущему рецепту;
 *  • заказы БЕЗ snapshot (легаси, созданные до Z-v29) считаются по текущему
 *    рецепту с явным флагом need_source="live"; backfill запрещён —
 *    достоверного источника исторических версий не существует.
 *
 * Не хранить только отображаемое название ингредиента: name — стабильный ключ
 * сопоставления (тот же, что в live-пути breakdown), inventory_item_id —
 * жёсткая привязка, когда она задана.
 */

import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/postgrest/pool";

/** Текущая версия структуры snapshot. Изменение формата = новая версия + чтение старых. */
export const ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION = 1;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Норма одного ингредиента на 1 единицу товара (исходная единица рецепта). */
export interface AcceptanceSnapshotIngredient {
  /** Стабильный ключ ингредиента (как в recipe_ingredients/live-пути breakdown). */
  name: string;
  /** Количество на 1 единицу товара, > 0 (нормы ≤ 0 срезаются на live-пути — тут паритет). */
  qty: number;
  /** Исходная единица рецепта ("г"|"мл"|"шт" и алиасы units.ts). Пустая → "шт". */
  unit: string;
  /** Жёсткая привязка к складской позиции, если модель её предусматривает. */
  inventory_item_id: string | null;
}

/** Snapshot одной товарной позиции заказа (агрегат строк корзины по product_id). */
export interface AcceptanceSnapshotItem {
  /** Идентификатор товара — связь с order_items.product_id (защита от подмены). */
  product_id: string;
  /** Отображаемое название (информационное; идентификация — по product_id). */
  title: string;
  /** Суммарное заказанное количество единиц этого товара (целое > 0). */
  quantity: number;
  /** Исходный рецепт (null — товар без рецепта; гейт checkout такой заказ не пропустит). */
  recipe_id: string | null;
  /** Версия рецепта из recipe_versions, если товарный контур начнёт её публиковать (сейчас всегда null). */
  recipe_version_id: string | null;
  /** updated_at рецепта на момент фиксации — дешёвый сигнал целостности/аудита. */
  recipe_updated_at: string | null;
  /** Производственные нормативы, используемые существующей логикой приёмки (production-duration.ts). */
  production_time_hours: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  category_slug: string | null;
  /** Нормы на 1 единицу товара. Пустой массив допустим (рецепт без ингредиентов). */
  ingredients: AcceptanceSnapshotIngredient[];
}

/** Корневая структура metadata.acceptance_snapshot. */
export interface AcceptanceSnapshot {
  schema_version: number;
  /** Уникальный идентификатор snapshot (uuid v4, генерируется сервером). */
  snapshot_id: string;
  /** Время фиксации (ISO). */
  created_at: string;
  /** Серверная операция, зафиксировавшая snapshot ("checkout" | "orders_b2b"). */
  source: string;
  /** Всегда false для свежих snapshot; зарезервировано для пометки legacy-восстановлений. */
  legacy: boolean;
  /** Позиции, отсортированные по product_id (детерминированное представление). */
  items: AcceptanceSnapshotItem[];
}

// ---------------------------------------------------------------------------
// Чтение и строгая валидация snapshot из orders.metadata
// ---------------------------------------------------------------------------

export type ParsedAcceptanceSnapshot =
  | { status: "absent" }
  | { status: "valid"; snapshot: AcceptanceSnapshot }
  | { status: "invalid"; reason: string };

/** Причины invalid — для диагностики в ответах API (SNAPSHOT_INVALID). */
export type SnapshotInvalidReason =
  | "unknown_schema_version"
  | "malformed"
  | "bad_item"
  | "bad_ingredient"
  | "empty_items";

function isUuidLike(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isNullableNumber(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}

/**
 * Прочитать и провалидировать snapshot из orders.metadata (уже распарсенного
 * JSON-объекта или null). Отсутствие snapshot — НЕ ошибка (легаси-заказ):
 * "absent". Повреждённый/частичный — "invalid" (fail-closed у потребителя),
 * никогда не «молчаливо используем текущий рецепт».
 */
export function readAcceptanceSnapshot(
  metadata: unknown
): ParsedAcceptanceSnapshot {
  if (metadata === null || metadata === undefined) return { status: "absent" };
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return { status: "absent" }; // metadata другого формата — snapshot не писался
  }
  const raw = (metadata as Record<string, unknown>).acceptance_snapshot;
  if (raw === null || raw === undefined) return { status: "absent" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "invalid", reason: "malformed" };
  }

  const snap = raw as Record<string, unknown>;
  if (snap.schema_version !== ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION) {
    return { status: "invalid", reason: "unknown_schema_version" };
  }
  if (typeof snap.snapshot_id !== "string" || !snap.snapshot_id) {
    return { status: "invalid", reason: "malformed" };
  }
  if (typeof snap.created_at !== "string" || !snap.created_at) {
    return { status: "invalid", reason: "malformed" };
  }
  if (typeof snap.source !== "string" || !snap.source) {
    return { status: "invalid", reason: "malformed" };
  }
  if (!Array.isArray(snap.items)) {
    return { status: "invalid", reason: "malformed" };
  }
  if (snap.items.length === 0) {
    return { status: "invalid", reason: "empty_items" };
  }

  const items: AcceptanceSnapshotItem[] = [];
  for (const rawItem of snap.items) {
    if (typeof rawItem !== "object" || rawItem === null) {
      return { status: "invalid", reason: "bad_item" };
    }
    const it = rawItem as Record<string, unknown>;
    if (!isUuidLike(it.product_id)) {
      return { status: "invalid", reason: "bad_item" };
    }
    if (
      typeof it.quantity !== "number" ||
      !Number.isInteger(it.quantity) ||
      it.quantity <= 0
    ) {
      return { status: "invalid", reason: "bad_item" };
    }
    if (it.recipe_id !== null && !isUuidLike(it.recipe_id)) {
      return { status: "invalid", reason: "bad_item" };
    }
    if (it.recipe_version_id !== null && typeof it.recipe_version_id !== "string") {
      return { status: "invalid", reason: "bad_item" };
    }
    if (!isNullableString(it.recipe_updated_at) || !isNullableString(it.title)) {
      return { status: "invalid", reason: "bad_item" };
    }
    if (
      !isNullableNumber(it.production_time_hours) ||
      !isNullableNumber(it.prep_time_minutes) ||
      !isNullableNumber(it.cook_time_minutes) ||
      !isNullableString(it.category_slug)
    ) {
      return { status: "invalid", reason: "bad_item" };
    }
    if (!Array.isArray(it.ingredients)) {
      return { status: "invalid", reason: "bad_item" };
    }

    const ingredients: AcceptanceSnapshotIngredient[] = [];
    for (const rawIng of it.ingredients) {
      if (typeof rawIng !== "object" || rawIng === null) {
        return { status: "invalid", reason: "bad_ingredient" };
      }
      const ing = rawIng as Record<string, unknown>;
      if (
        typeof ing.name !== "string" ||
        !ing.name.trim() ||
        ing.name.trim().length > 200
      ) {
        return { status: "invalid", reason: "bad_ingredient" };
      }
      if (
        typeof ing.qty !== "number" ||
        !Number.isFinite(ing.qty) ||
        ing.qty <= 0
      ) {
        return { status: "invalid", reason: "bad_ingredient" };
      }
      if (typeof ing.unit !== "string" || !ing.unit.trim()) {
        return { status: "invalid", reason: "bad_ingredient" };
      }
      if (
        ing.inventory_item_id !== null &&
        typeof ing.inventory_item_id !== "string"
      ) {
        return { status: "invalid", reason: "bad_ingredient" };
      }
      ingredients.push({
        name: ing.name.trim(),
        qty: ing.qty,
        unit: ing.unit.trim(),
        inventory_item_id: ing.inventory_item_id,
      });
    }

    items.push({
      product_id: it.product_id,
      title: it.title ?? "",
      quantity: it.quantity,
      recipe_id: it.recipe_id,
      recipe_version_id: (it.recipe_version_id as string | null) ?? null,
      recipe_updated_at: it.recipe_updated_at,
      production_time_hours: it.production_time_hours,
      prep_time_minutes: it.prep_time_minutes,
      cook_time_minutes: it.cook_time_minutes,
      category_slug: it.category_slug,
      ingredients,
    });
  }

  return {
    status: "valid",
    snapshot: {
      schema_version: ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION,
      snapshot_id: snap.snapshot_id,
      created_at: snap.created_at,
      source: snap.source,
      legacy: snap.legacy === true,
      items,
    },
  };
}

/**
 * Проверить, что snapshot покрывает товарные позиции заказа (по product_id)
 * и количества совпадают. Расхождение = повреждение/подмена → fail-closed.
 * Позиции order_items с product_id=null (custom/удалённый товар) не проверяются.
 */
export function validateSnapshotCoversOrder(
  snapshot: AcceptanceSnapshot,
  orderProductItems: Array<{ product_id: string; quantity: number }>
): { ok: true } | { ok: false; reason: string } {
  const byProduct = new Map<string, number>();
  for (const it of snapshot.items) {
    byProduct.set(it.product_id, (byProduct.get(it.product_id) ?? 0) + it.quantity);
  }
  const orderTotals = new Map<string, number>();
  for (const it of orderProductItems) {
    orderTotals.set(it.product_id, (orderTotals.get(it.product_id) ?? 0) + it.quantity);
  }
  if (byProduct.size !== orderTotals.size) {
    return { ok: false, reason: "product_set_mismatch" };
  }
  for (const [pid, qty] of orderTotals) {
    const snapQty = byProduct.get(pid);
    if (snapQty === undefined) {
      return { ok: false, reason: "product_set_mismatch" };
    }
    if (snapQty !== qty) {
      return { ok: false, reason: `quantity_mismatch:${pid}` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Сборка snapshot на сервере (checkout / POST /api/orders)
// ---------------------------------------------------------------------------

export interface BuildSnapshotInput {
  /** Товарные позиции корзины; позиции одного товара агрегируются по quantity. */
  items: Array<{ product_id: string; quantity: number }>;
  /** Метка создавшей серверной операции ("checkout" | "orders_b2b"). */
  source: string;
}

export type BuildSnapshotResult =
  | { ok: true; snapshot: AcceptanceSnapshot }
  | { ok: false; error: string };

/**
 * Собрать snapshot производственной потребности по ТЕКУЩЕМУ состоянию БД
 * (products → recipes → categories → recipe_ingredients). Вызывается строго
 * в момент фиксации заказа — результат попадает в тот же INSERT orders.
 *
 * Ошибка БД/не найденный товар → { ok: false } — вызывающий обязан прервать
 * создание заказа (fail-closed: недопустим платёж без производственного снимка).
 */
export async function buildAcceptanceSnapshot(
  input: BuildSnapshotInput
): Promise<BuildSnapshotResult> {
  // Агрегация по product_id: две строки корзины одного товара = одна позиция
  // snapshot с суммарным quantity (детерминированно, устойчиво к разбивке строк).
  const qtyByProduct = new Map<string, number>();
  for (const item of input.items) {
    if (!isUuidLike(item.product_id)) {
      return { ok: false, error: "bad_product_id" };
    }
    const q = Number(item.quantity);
    if (!Number.isInteger(q) || q <= 0) {
      return { ok: false, error: "bad_quantity" };
    }
    qtyByProduct.set(item.product_id, (qtyByProduct.get(item.product_id) ?? 0) + q);
  }
  const productIds = [...qtyByProduct.keys()].sort();
  if (productIds.length === 0) {
    return { ok: false, error: "no_product_items" };
  }

  const pool = getPool();

  // SQL 1: товары + рецепты + категории (производственные нормативы приёмки)
  let productRows: Array<{
    id: string;
    title: string | null;
    recipe_id: string | null;
    production_time_hours: number | null;
    prep_time_minutes: number | null;
    cook_time_minutes: number | null;
    recipe_updated_at: Date | string | null;
    category_slug: string | null;
  }>;
  try {
    const res = await pool.query<{
      id: string;
      title: string | null;
      recipe_id: string | null;
      production_time_hours: number | null;
      prep_time_minutes: number | null;
      cook_time_minutes: number | null;
      recipe_updated_at: Date | string | null;
      category_slug: string | null;
    }>(
      `SELECT p.id::text, p.title,
              p.recipe_id::text,
              p.production_time_hours,
              r.prep_time_minutes, r.cook_time_minutes,
              r.updated_at AS recipe_updated_at,
              c.slug AS category_slug
       FROM public.products p
       LEFT JOIN public.recipes r ON r.id = p.recipe_id
       LEFT JOIN public.product_categories c ON c.id = p.category_id
       WHERE p.id = ANY($1::uuid[])`,
      [productIds]
    );
    productRows = res.rows;
  } catch (e) {
    return { ok: false, error: `products_load_failed: ${(e as Error).message}` };
  }
  if (productRows.length !== productIds.length) {
    const found = new Set(productRows.map((r) => r.id));
    const missing = productIds.filter((id) => !found.has(id));
    return { ok: false, error: `products_not_found: ${missing.join(",")}` };
  }

  // SQL 2: нормы всех задействованных рецептов (parity с live-путью breakdown)
  const recipeIds = [
    ...new Set(productRows.map((r) => r.recipe_id).filter((x): x is string => x !== null)),
  ];
  let ingredientRows: Array<{
    recipe_id: string;
    name: string;
    qty: string | number;
    unit: string;
    inventory_item_id: string | null;
  }> = [];
  if (recipeIds.length > 0) {
    try {
      const res = await pool.query<{
        recipe_id: string;
        name: string;
        qty: string | number;
        unit: string;
        inventory_item_id: string | null;
      }>(
        `SELECT recipe_id::text, name, qty, unit, inventory_item_id::text
         FROM public.recipe_ingredients
         WHERE recipe_id = ANY($1::uuid[])
         ORDER BY recipe_id, sort_order, name`,
        [recipeIds]
      );
      ingredientRows = res.rows;
    } catch (e) {
      return { ok: false, error: `ingredients_load_failed: ${(e as Error).message}` };
    }
  }

  const ingredientsByRecipe = new Map<string, AcceptanceSnapshotIngredient[]>();
  for (const row of ingredientRows) {
    const perUnit = Number(row.qty);
    // Паритет с live-агрегацией breakdown: нормы ≤ 0 не участвуют в расчёте.
    if (!Number.isFinite(perUnit) || perUnit <= 0) continue;
    const list = ingredientsByRecipe.get(row.recipe_id) ?? [];
    list.push({
      name: row.name.trim(),
      qty: perUnit,
      unit: row.unit.trim() || "шт",
      inventory_item_id: row.inventory_item_id,
    });
    ingredientsByRecipe.set(row.recipe_id, list);
  }

  const items: AcceptanceSnapshotItem[] = productIds.map((pid) => {
    const p = productRows.find((r) => r.id === pid);
    const recipeId = p?.recipe_id ?? null;
    const updated = p?.recipe_updated_at ?? null;
    return {
      product_id: pid,
      title: p?.title ?? "",
      quantity: qtyByProduct.get(pid) ?? 0,
      recipe_id: recipeId,
      // Товарный контур сейчас не публикует recipe_versions — поле для эволюции к варианту B/C.
      recipe_version_id: null,
      recipe_updated_at: updated
        ? updated instanceof Date
          ? updated.toISOString()
          : String(updated)
        : null,
      production_time_hours: p?.production_time_hours ?? null,
      prep_time_minutes: p?.prep_time_minutes ?? null,
      cook_time_minutes: p?.cook_time_minutes ?? null,
      category_slug: p?.category_slug ?? null,
      ingredients: recipeId ? (ingredientsByRecipe.get(recipeId) ?? []) : [],
    };
  });

  return {
    ok: true,
    snapshot: {
      schema_version: ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION,
      snapshot_id: randomUUID(),
      created_at: new Date().toISOString(),
      source: input.source,
      legacy: false,
      items,
    },
  };
}
