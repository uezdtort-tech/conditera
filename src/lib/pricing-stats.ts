/**
 * pricing-stats.ts — чистые (isomorphic) расчёты ценовых статистик.
 *
 * Используется и на сервере (API-роут /api/pricing/regional), и на клиенте
 * (regional-pricing fallback). Не импортирует БД/админ-клиент — только данные.
 */

export interface PriceSampleRow {
  price: number;
  weight_grams?: number | null;
  servings?: number | null;
}

export interface MedianPricePerKg {
  median: number;
  count: number;
}

/**
 * Посчитать медианную цену за 1 кг по выборке продуктов.
 *
 * Правила:
 *   • weight_grams (число, граммы) → price_per_kg = price / (grams/1000)
 *   • нет веса → servings * 0.15 кг (1 порция ≈ 150 г)
 *   • нереалистичные веса (≥50 кг) и цены ≤ 0 отбрасываются
 *
 * @example
 *   computeMedianPricePerKg([{ price: 2000, weight_grams: 1000 }]) // { median: 2000, count: 1 }
 */
export function computeMedianPricePerKg(rows: PriceSampleRow[]): MedianPricePerKg {
  const pricesPerKg: number[] = [];

  for (const p of rows || []) {
    if (typeof p.price !== "number" || p.price <= 0) continue;

    let weightKg = 0;
    if (typeof p.weight_grams === "number" && p.weight_grams > 0) {
      weightKg = p.weight_grams / 1000;
    }
    if (weightKg > 0 && weightKg < 50) {
      // Защита от нереалистичных весов (≥50 кг — явно ошибка)
      pricesPerKg.push(p.price / weightKg);
    } else if (p.servings && p.servings > 0) {
      // Fallback: если нет веса, используем servings (1 порция ≈ 150 г)
      const estimatedWeightKg = p.servings * 0.15;
      if (estimatedWeightKg > 0 && estimatedWeightKg < 50) {
        pricesPerKg.push(p.price / estimatedWeightKg);
      }
    }
  }

  if (pricesPerKg.length === 0) return { median: 0, count: 0 };

  pricesPerKg.sort((a, b) => a - b);
  const mid = Math.floor(pricesPerKg.length / 2);
  const median =
    pricesPerKg.length % 2 === 0
      ? (pricesPerKg[mid - 1] + pricesPerKg[mid]) / 2
      : pricesPerKg[mid];

  return { median, count: pricesPerKg.length };
}
