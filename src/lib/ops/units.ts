/**
 * units.ts — нормализация и конвертация кулинарных единиц (Task 2-b).
 *
 * Поддерживаются три измерения:
 *   • масса — базовая единица «г» (кг = 1000 г);
 *   • объём — базовая единица «мл» (л = 1000 мл);
 *   • штуки — базовая единица «шт» (без кратных).
 *
 * normalizeUnit("Литр") → "мл", convertQty(2, "кг", "г") → 2000,
 * convertQty(1, "г", "мл") → null (несовместимые измерения).
 * Всё чисто, без any; числа без «плавающей пыли» (округление до 6 знаков).
 */

export type Unit = "г" | "мл" | "шт";

/** Сколько базовых единиц (г/мл/шт) в одном алиасе. */
interface UnitAlias {
  unit: Unit;
  factor: number;
}

/**
 * Словарь алиасов. Ключ — raw-единица в lower-case после trim.
 * Замечание: normalizeUnit("л") возвращает "мл" (канон объёма), а множитель
 * ×1000 учитывается в convertQty через factor — это осознанный контракт ТЗ.
 */
const UNIT_ALIASES: Record<string, UnitAlias> = {
  // масса (база — г)
  "г": { unit: "г", factor: 1 },
  "гр": { unit: "г", factor: 1 },
  "gram": { unit: "г", factor: 1 },
  "грамм": { unit: "г", factor: 1 },
  "кг": { unit: "г", factor: 1000 },
  "kg": { unit: "г", factor: 1000 },
  "kilogram": { unit: "г", factor: 1000 },
  "килограмм": { unit: "г", factor: 1000 },

  // объём (база — мл)
  "мл": { unit: "мл", factor: 1 },
  "ml": { unit: "мл", factor: 1 },
  "миллилитр": { unit: "мл", factor: 1 },
  "milliliter": { unit: "мл", factor: 1 },
  "л": { unit: "мл", factor: 1000 },
  "l": { unit: "мл", factor: 1000 },
  "liter": { unit: "мл", factor: 1000 },
  "литр": { unit: "мл", factor: 1000 },

  // штуки (база — шт)
  "шт": { unit: "шт", factor: 1 },
  "штука": { unit: "шт", factor: 1 },
  "штук": { unit: "шт", factor: 1 },
  "pcs": { unit: "шт", factor: 1 },
  "piece": { unit: "шт", factor: 1 },
};

/** Убрать «плавающую пыль» (0.1+0.2 ситуации) — до 6 значащих знаков. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Нормализовать raw-единицу к канонической: "г","гр","gram","грамм" → "г";
 * "мл","ml","л","liter" → "мл" (л = ×1000, см. convertQty);
 * "шт","pcs","piece" → "шт". Неизвестное → null.
 */
export function normalizeUnit(raw: string): Unit | null {
  if (typeof raw !== "string") return null;
  const alias = UNIT_ALIASES[raw.trim().toLowerCase()];
  return alias ? alias.unit : null;
}

/**
 * Конвертировать количество из одной единицы в другую.
 * г↔кг, мл↔л, внутри одного измерения; несовместимые измерения
 * (г→мл, шт→кг) или неизвестные единицы → null.
 */
export function convertQty(qty: number, from: string, to: string): number | null {
  if (!Number.isFinite(qty)) return null;
  const a = UNIT_ALIASES[String(from).trim().toLowerCase()];
  const b = UNIT_ALIASES[String(to).trim().toLowerCase()];
  if (!a || !b || a.unit !== b.unit) return null;
  return round6((qty * a.factor) / b.factor);
}
