/**
 * cost.ts — ЕДИНЫЙ серверный калькулятор себестоимости производственных карт
 * (RECIPE-02/05, RA.12 спеки docs/product/RECIPE_01_AUDIT_AND_TARGET_ARCHITECTURE.md).
 *
 * Инварианты RA.12:
 *   1. Цены НИКОГДА не приходят от клиента — читаются серверно из
 *      inventory_items.cost_per_unit (INTEGER, целые рубли за единицу позиции,
 *      миграция 0010:226; Ф-20: единица денег — рубли INTEGER).
 *   2. Единица денег на уровне колонок history — ЦЕЛЫЕ РУБЛИ (recipe_card_cost_history,
 *      0070:229-230); промежуточная копеечная точность допустима ТОЛЬКО внутри
 *      breakdown JSONB (Q-9) — здесь это *_kopecks поля.
 *   3. Масштабирование линейное только по конвертируемым единицам
 *      (семейства г/мл/шт); масса↔объём НЕ конвертируется (плотностей в схеме нет).
 *   4. Потери: waste_pct нормы увеличивает потребление (эффективное количество).
 *   5. История НЕ пересчитывается задним числом: расчёт вызывается только при
 *      approve/recompute и фиксируется в recipe_card_cost_history с
 *      price_basis='inventory_current' (сценарий №13 приёмки: последующее
 *      изменение cost_per_unit не переписывает history).
 *
 * Контракт calcCardCost (RB.14, /api/production/cards/[id]/approve):
 *   calcCardCost(norms, prices) → {
 *     costPerUnitRub: int,        — округление до целых рублей (прозрачное)
 *     costPerBatchRub: int,       — на каноническую партию карты
 *     breakdown: { positions: [{ inventory_item_id, name, qty, unit,
 *                  converted_qty, converted_unit, unit_price_kopecks,
 *                  cost_kopecks, waste_pct, is_optional }],
 *                  batch: {...}, totals: {...} }
 *   }
 *
 * @module @/lib/recipes/cost
 */

// === Канонизация и конвертация единиц (RA.12 инвариант 3) ===

export type UnitFamily = "mass" | "volume" | "count";

/** Фактор к базовой единице семейства (г / мл / шт) */
const UNIT_FACTORS: Record<string, { family: UnitFamily; factor: number }> = {
  // масса → г
  "г": { family: "mass", factor: 1 },
  "g": { family: "mass", factor: 1 },
  "гр": { family: "mass", factor: 1 },
  "кг": { family: "mass", factor: 1000 },
  "kg": { family: "mass", factor: 1000 },
  // объём → мл
  "мл": { family: "volume", factor: 1 },
  "ml": { family: "volume", factor: 1 },
  "л": { family: "volume", factor: 1000 },
  "l": { family: "volume", factor: 1000 },
  // количество → шт
  "шт": { family: "count", factor: 1 },
  "pc": { family: "count", factor: 1 },
  "pcs": { family: "count", factor: 1 },
  "piece": { family: "count", factor: 1 },
};

/**
 * Нормализовать строку единицы к канону (г/мл/шт/кг/л как есть в БД).
 * Возвращает null для неизвестных единиц («по вкусу», display-единицы) —
 * такие нормы не конвертируются и не участвуют в точном расчёте.
 */
export function parseUnit(raw: unknown): { unit: string; family: UnitFamily; factor: number } | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  const found = UNIT_FACTORS[key];
  if (!found) return null;
  return { unit: raw.trim(), family: found.family, factor: found.factor };
}

export type ConvertResult =
  | { ok: true; qty: number }
  | { ok: false; reason: "unknown_unit" | "family_mismatch" };

/**
 * Конвертировать количество между единицами ОДНОГО семейства
 * (г↔кг, мл↔л, шт↔шт). Масса↔объём — намеренно запрещено (RA.12.3).
 */
export function convertQty(qty: number, from: string, to: string): ConvertResult {
  const f = parseUnit(from);
  const t = parseUnit(to);
  if (!f) return { ok: false, reason: "unknown_unit" };
  if (!t) return { ok: false, reason: "unknown_unit" };
  if (f.family !== t.family) return { ok: false, reason: "family_mismatch" };
  return { ok: true, qty: (qty * f.factor) / t.factor };
}

// === Входы калькулятора ===

/**
 * Норма из снапшота версии карты (recipe_production_card_versions.snapshot)
 * или из recipe_production_ingredients. Структура — 0070:95-110.
 */
export interface CardNormSnapshot {
  inventory_item_id: string | null;
  qty_per_unit: number;
  qty_per_batch?: number | null;
  unit: string;
  brutto_qty?: number | null;
  waste_pct?: number | null;
  is_optional?: boolean | null;
}

/** Серверная цена позиции склада (inventory_items, 0010:218-231) */
export interface InventoryPrice {
  id: string;
  name: string | null;
  unit: string | null;
  /** Целые рубли за единицу позиции (Ф-20); NULL трактуем как 0 */
  cost_per_unit: number | null;
}

export interface CostPosition {
  inventory_item_id: string;
  name: string | null;
  /** Норма на единицу выпуска в единице нормы */
  qty: number;
  unit: string;
  /** Норма, приведённая к единице складской позиции */
  converted_qty: number;
  converted_unit: string | null;
  /** Цена складской позиции в КОПЕЙКАХ за её единицу (промежуточная точность — Q-9) */
  unit_price_kopecks: number;
  /** Стоимость позиции на единицу выпуска в КОПЕЙКАХ (промежуточная точность — Q-9) */
  cost_kopecks: number;
  waste_pct: number;
  is_optional: boolean;
}

export interface CardCostResult {
  costPerUnitRub: number;
  costPerBatchRub: number;
  breakdown: {
    positions: CostPosition[];
    batch: { units: number | null; unit: string | null; cost_kopecks: number };
    totals: { cost_per_unit_kopecks: number; cost_per_batch_kopecks: number };
  };
}

const MAX_NORMS = 200;

/**
 * Рассчитать нормативную себестоимость карты.
 *
 * @param norms     нормы из снапшота версии карты (привязанные к складу:
 *                  inventory_item_id NOT NULL — гейт approve, RB.15)
 * @param prices    серверные цены inventory_items (читает ВЫЗЫВАЮЩИЙ маршрут
 *                  через supabaseAdmin; клиентские цены не принимаются никогда)
 * @param batch     каноническая партия карты: portions_per_batch (шт) и/или
 *                  batch_yield_qty в batch_yield_unit
 */
export function calcCardCost(
  norms: CardNormSnapshot[],
  prices: InventoryPrice[],
  batch?: { portionsPerBatch?: number | null; batchYieldQty?: number | null; batchYieldUnit?: string | null }
): CardCostResult {
  const priceById = new Map<string, InventoryPrice>();
  for (const p of prices) priceById.set(p.id, p);

  const positions: CostPosition[] = [];
  let totalKopecks = 0;

  for (const norm of norms.slice(0, MAX_NORMS)) {
    if (!norm.inventory_item_id) continue; // гейт approve отсекает ранее
    const price = priceById.get(norm.inventory_item_id);
    if (!price) continue; // цена недоступна — позиция не попадает в расчёт (fail-soft)

    const qtyPerUnit = Number(norm.qty_per_unit) || 0;
    const wastePct = Math.min(Math.max(Number(norm.waste_pct) || 0, 0), 100);
    // Эффективное потребление с учётом потерь (RA.12.5)
    const effectiveQty = qtyPerUnit * (1 + wastePct / 100);

    // Приведение нормы к единице складской позиции (цена — за единицу позиции)
    let convertedQty = effectiveQty;
    let convertedUnit = price.unit ?? null;
    let convertible = true;
    if (price.unit) {
      const res = convertQty(effectiveQty, norm.unit, price.unit);
      if (res.ok) {
        convertedQty = res.qty;
        convertedUnit = price.unit;
      } else if (res.reason === "family_mismatch") {
        // Норма в г, склад в шт и т.п. — ложных преобразований не делаем:
        // считаем в единицах нормы, цену трактуем как «за единицу нормы» (fail-soft)
        convertible = false;
      } else {
        convertible = false;
      }
    }

    const unitPriceKopecks = Math.round((Number(price.cost_per_unit) || 0) * 100);
    // Если единицы несоизмеримы — стоимость позиции не накапливаем (нет цены в этой размерности)
    const costKopecks = convertible ? Math.round(convertedQty * unitPriceKopecks) : 0;

    totalKopecks += costKopecks;
    positions.push({
      inventory_item_id: norm.inventory_item_id,
      name: price.name ?? null,
      qty: effectiveQty,
      unit: norm.unit,
      converted_qty: Math.round(convertedQty * 1000) / 1000,
      converted_unit: convertible ? convertedUnit : null,
      unit_price_kopecks: unitPriceKopecks,
      cost_kopecks: costKopecks,
      waste_pct: wastePct,
      is_optional: norm.is_optional === true,
    });
  }

  // Канонический объём партии карты: приоритет — portions_per_batch (шт),
  // затем batch_yield_qty в batch_yield_unit (если соизмеримо с «единицей выпуска»)
  let batchUnits: number | null = null;
  let batchUnit: string | null = null;
  if (batch?.portionsPerBatch && batch.portionsPerBatch > 0) {
    batchUnits = Number(batch.portionsPerBatch);
    batchUnit = "шт";
  } else if (batch?.batchYieldQty && batch.batchYieldQty > 0) {
    batchUnits = Number(batch.batchYieldQty);
    batchUnit = batch.batchYieldUnit ?? null;
  }

  const batchKopecks = batchUnits !== null ? Math.round(totalKopecks * batchUnits) : totalKopecks;

  return {
    costPerUnitRub: Math.round(totalKopecks / 100),
    costPerBatchRub: Math.round(batchKopecks / 100),
    breakdown: {
      positions,
      batch: { units: batchUnits, unit: batchUnit, cost_kopecks: batchKopecks },
      totals: { cost_per_unit_kopecks: totalKopecks, cost_per_batch_kopecks: batchKopecks },
    },
  };
}
