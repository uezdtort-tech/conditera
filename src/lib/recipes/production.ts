/**
 * production.ts — общие серверные хелперы производственного контура
 * (RECIPE-02/05: карты, версии, партии; RA.11/RB.14/RB.15 спеки
 * docs/product/RECIPE_01_AUDIT_AND_TARGET_ARCHITECTURE.md).
 *
 * Правила контура:
 *   • весь доступ — через API-слой (supabaseAdmin), RLS — вторая линия (RB.16);
 *   • owner_id/статусы/цены/нормы/идемпотентные ключи клиенту не доверяются;
 *   • ПР-6: SUPPLIER не допускается в производственный контур (403).
 *
 * @module @/lib/recipes/production
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Каноничные единицы партии (RA.11.1: planned_unit — канон г/мл/шт) */
export function parseCanonicalPlannedUnit(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim().toLowerCase();
  if (["г", "g", "гр", "кг", "kg"].includes(u)) return "г";
  if (["мл", "ml", "л", "l"].includes(u)) return "мл";
  if (["шт", "pc", "pcs", "piece"].includes(u)) return "шт";
  return null;
}

/** Строгий парс положительного числа (numeric(12,3) CHECK > 0) */
export function parsePositiveNumber(raw: unknown, max = 1_000_000_000): number | null {
  const n = typeof raw === "string" ? Number(raw.replace(",", ".")) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > max) return null;
  return Math.round(n * 1000) / 1000;
}

/** Парс процента потерь 0..100 (waste_pct NUMERIC(5,2), 0070:104) */
export function parseWastePct(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = typeof raw === "string" ? Number(raw.replace(",", ".")) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

/** Парс целого ≥ 0 (portions_per_batch INT) */
export function parseNonNegativeInt(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 1_000_000) return null;
  return n;
}

/**
 * Роли производственного контура (ПР-6): CONFECTIONER-семейство + ADMIN.
 * BUSINESS_CONFECTIONER/ENTERPRISE отсутствуют в enum user_role
 * (src/lib/supabase/types.ts) — whitelist допускает их заранее (роль появится —
 * доступ не сломается), сегодня фактически проходят CONFECTIONER/ADMIN/SUPER_ADMIN.
 * SUPPLIER и прочие → 403.
 */
export const PRODUCTION_ROLES = [
  "CONFECTIONER",
  "BUSINESS_CONFECTIONER",
  "ENTERPRISE",
  "ADMIN",
  "SUPER_ADMIN",
] as const;

export function hasProductionRole(userRoles: string[]): boolean {
  return userRoles.some((r) => (PRODUCTION_ROLES as readonly string[]).includes(r));
}

/** Явно запретить SUPPLIER (ПР-6) — отдельная ветка для точного сообщения */
export function isSupplierRole(userRoles: string[]): boolean {
  return userRoles.some((r) => r === "SUPPLIER");
}

export function isAdminRole(userRoles: string[]): boolean {
  return userRoles.some((r) => r === "ADMIN" || r === "SUPER_ADMIN");
}

// === Снапшот карты (recipe_production_card_versions.snapshot, 0070:130-139) ===

export interface CardRow {
  id: string;
  owner_id: string;
  recipe_id: string;
  recipe_version_id: string | null;
  product_id: string | null;
  title: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  batch_yield_qty: number | string | null;
  batch_yield_unit: string | null;
  portions_per_batch: number | null;
  created_at: string;
  updated_at: string;
}

export interface CardIngredientRow {
  id: string;
  card_id: string;
  source_ingredient_id: string | null;
  inventory_item_id: string | null;
  qty_per_unit: number | string;
  qty_per_batch: number | string | null;
  unit: string;
  brutto_qty: number | string | null;
  waste_pct: number | string | null;
  is_optional: boolean;
}

export interface CardSnapshot {
  card: {
    id: string;
    owner_id: string;
    recipe_id: string;
    recipe_version_id: string | null;
    product_id: string | null;
    title: string;
    batch_yield_qty: number | null;
    batch_yield_unit: string | null;
    portions_per_batch: number | null;
  };
  ingredients: Array<{
    id: string;
    source_ingredient_id: string | null;
    inventory_item_id: string | null;
    qty_per_unit: number;
    qty_per_batch: number | null;
    unit: string;
    brutto_qty: number | null;
    waste_pct: number;
    is_optional: boolean;
  }>;
  approved_at: string;
}

/** Числовые numeric-колонки PostgREST-шим отдаёт строками — нормализуем */
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Собрать полный снапшот карты+норм на момент approve (RB.13 прим.4) */
export function buildCardSnapshot(
  card: CardRow,
  ingredients: CardIngredientRow[],
  approvedAt: string
): CardSnapshot {
  return {
    card: {
      id: card.id,
      owner_id: card.owner_id,
      recipe_id: card.recipe_id,
      recipe_version_id: card.recipe_version_id,
      product_id: card.product_id,
      title: card.title,
      batch_yield_qty: num(card.batch_yield_qty),
      batch_yield_unit: card.batch_yield_unit,
      portions_per_batch: card.portions_per_batch,
    },
    ingredients: ingredients.map((i) => ({
      id: i.id,
      source_ingredient_id: i.source_ingredient_id,
      inventory_item_id: i.inventory_item_id,
      qty_per_unit: num(i.qty_per_unit) ?? 0,
      qty_per_batch: num(i.qty_per_batch),
      unit: i.unit,
      brutto_qty: num(i.brutto_qty),
      waste_pct: num(i.waste_pct) ?? 0,
      is_optional: i.is_optional === true,
    })),
    approved_at: approvedAt,
  };
}

/**
 * Канонический JSON для сравнения снапшотов (детерминированный порядок ключей).
 * Используется approve-маршрутом: повторный approve БЕЗ правок → та же версия
 * (идемпотентный replay, RB.14).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

// === Whitelist-сериализация карточек (Ф «видимость себестоимости») ===

/**
 * Сериализация карты для ответов API.
 * Нормы (состав) и себестоимость отдаются ТОЛЬКО владельцу карты; ADMIN видит
 * чужие карты без норм/цен (метаданные) — видимость себестоимости = владелец.
 */
export function serializeCard(
  card: CardRow,
  opts: {
    isOwner: boolean;
    latestVersionNo?: number | null;
    latestVersionId?: string | null;
  }
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: card.id,
    owner_id: card.owner_id,
    recipe_id: card.recipe_id,
    recipe_version_id: card.recipe_version_id,
    product_id: card.product_id,
    title: card.title,
    status: card.status,
    approved_by: card.approved_by,
    approved_at: card.approved_at,
    batch_yield_qty: num(card.batch_yield_qty),
    batch_yield_unit: card.batch_yield_unit,
    portions_per_batch: card.portions_per_batch,
    created_at: card.created_at,
    updated_at: card.updated_at,
    latest_version_no: opts.latestVersionNo ?? null,
    latest_card_version_id: opts.latestVersionId ?? null,
    is_owner: opts.isOwner,
  };
  return base;
}

/** Сериализация нормы — только для владельца карты */
export function serializeIngredient(i: CardIngredientRow): Record<string, unknown> {
  return {
    id: i.id,
    card_id: i.card_id,
    source_ingredient_id: i.source_ingredient_id,
    inventory_item_id: i.inventory_item_id,
    qty_per_unit: num(i.qty_per_unit),
    qty_per_batch: num(i.qty_per_batch),
    unit: i.unit,
    brutto_qty: num(i.brutto_qty),
    waste_pct: num(i.waste_pct),
    is_optional: i.is_optional === true,
  };
}

// === Партии (recipe_production_batches, 0070:265-283 / RA.11.1) ===

export interface BatchRow {
  id: string;
  card_version_id: string;
  owner_id: string;
  order_id: string | null;
  planned_qty: number | string;
  planned_unit: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** alias для частичных выборок (PATCH batches/[id]) */
export type BatchRowLite = BatchRow;

/** numeric-колонки PostgREST-шим отдаёт строками — нормализуем к numbers */
export function serializeBatch(batch: BatchRow): Record<string, unknown> {
  return {
    id: batch.id,
    card_version_id: batch.card_version_id,
    owner_id: batch.owner_id,
    order_id: batch.order_id,
    planned_qty: Number(batch.planned_qty),
    planned_unit: batch.planned_unit,
    status: batch.status,
    notes: batch.notes,
    created_at: batch.created_at,
    updated_at: batch.updated_at,
  };
}

// === Нормы карты: парсинг и валидация входа (§F.10, 0070:95-110) ===

const MAX_NORMS = 200;

export interface NormInput {
  source_ingredient_id: string | null;
  inventory_item_id: string | null;
  qty_per_unit: number;
  qty_per_batch: number | null;
  unit: string;
  brutto_qty: number | null;
  waste_pct: number;
  is_optional: boolean;
}

/**
 * Спарсить и провалидировать массив норм карты из тела запроса.
 * inventory_item_id может быть NULL в черновике — гейт «все нормы привязаны»
 * проверяет approve (RB.15: approve при непривязанных нормах запрещён).
 */
export function parseCardNormsInput(raw: unknown):
  | { norms: NormInput[] }
  | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "norms обязателен (непустой массив норм)" };
  }
  if (raw.length > MAX_NORMS) {
    return { error: `Слишком много норм (макс ${MAX_NORMS})` };
  }
  const norms: NormInput[] = [];
  for (const rawNorm of raw) {
    const n = rawNorm as Record<string, unknown>;
    const qtyPerUnit = parsePositiveNumber(n.qty_per_unit);
    if (qtyPerUnit === null) {
      return { error: "Каждая норма требует qty_per_unit > 0" };
    }
    const unit = typeof n.unit === "string" && n.unit.trim() ? n.unit.trim().slice(0, 50) : null;
    if (!unit) {
      return { error: "Каждая норма требует unit" };
    }
    const inventoryItemId = isUuid(n.inventory_item_id)
      ? (n.inventory_item_id as string).trim()
      : null;
    const sourceIngredientId = isUuid(n.source_ingredient_id)
      ? (n.source_ingredient_id as string).trim()
      : null;
    const wastePct = parseWastePct(n.waste_pct);
    if (wastePct === null) {
      return { error: "waste_pct должен быть числом 0..100" };
    }
    const qtyPerBatch =
      n.qty_per_batch === undefined || n.qty_per_batch === null
        ? null
        : parsePositiveNumber(n.qty_per_batch);
    if (n.qty_per_batch !== undefined && n.qty_per_batch !== null && qtyPerBatch === null) {
      return { error: "qty_per_batch должен быть числом > 0" };
    }
    const bruttoQty =
      n.brutto_qty === undefined || n.brutto_qty === null
        ? null
        : parsePositiveNumber(n.brutto_qty);
    if (n.brutto_qty !== undefined && n.brutto_qty !== null && bruttoQty === null) {
      return { error: "brutto_qty должен быть числом > 0" };
    }
    norms.push({
      source_ingredient_id: sourceIngredientId,
      inventory_item_id: inventoryItemId,
      qty_per_unit: qtyPerUnit,
      qty_per_batch: qtyPerBatch,
      unit,
      brutto_qty: bruttoQty,
      waste_pct: wastePct,
      is_optional: n.is_optional === true,
    });
  }
  return { norms };
}

/**
 * Проверить, что все inventory_item_id норм принадлежат складу владельца
 * (склад owner-only, 0010). Возвращает id чужих/несуществующих позиций.
 */
export async function findForeignInventoryItems(
  norms: NormInput[],
  ownerId: string
): Promise<string[]> {
  const itemIds = [...new Set(norms.map((n) => n.inventory_item_id).filter(Boolean))] as string[];
  if (itemIds.length === 0) return [];
  const { data: items, error } = await supabaseAdmin
    .from("inventory_items")
    .select("id, owner_id")
    .in("id", itemIds);
  if (error) throw new Error(`inventory lookup failed: ${error.message}`);
  const owned = new Set(
    ((items ?? []) as Array<{ id: string; owner_id: string }>)
      .filter((i) => i.owner_id === ownerId)
      .map((i) => i.id)
  );
  return itemIds.filter((id) => !owned.has(id));
}

/**
 * Загрузить карту + последнюю версию карты.
 * Возвращает null, если карта не найдена.
 */
export async function loadCardWithLatestVersion(
  cardId: string
): Promise<{
  card: CardRow;
  latestVersionNo: number | null;
  latestVersionId: string | null;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("recipe_production_cards")
    .select("*")
    .eq("id", cardId)
    .maybeSingle();
  if (error) throw new Error(`loadCard failed: ${error.message}`);
  const card = data as CardRow | null;
  if (!card) return null;

  const { data: ver, error: verErr } = await supabaseAdmin
    .from("recipe_production_card_versions")
    .select("id, version_no")
    .eq("card_id", cardId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (verErr) throw new Error(`loadCardVersion failed: ${verErr.message}`);

  return {
    card,
    latestVersionNo: ver ? Number((ver as { version_no: number }).version_no) : null,
    latestVersionId: ver ? String((ver as { id: string }).id) : null,
  };
}
