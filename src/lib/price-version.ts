/**
 * price-version.ts — серверный резолв цены через pg-функцию
 * get_product_price_at (миграция 0083) + ленивый catch-up
 * sync_effective_product_prices (PR-2C).
 *
 * Контракт (деньги-путь, fail-safe):
 *  - syncEffectiveProductPricesSafe НИКОГДА не бросает: сбой синка не должен
 *    валить заказ/каталог — цены всё равно resolv'ятся по факту функцией.
 *  - resolveCurrentPriceSafe возвращает НЕ-null ТОЛЬКО когда есть покрывающая
 *    now строка истории с версией (version_id NOT NULL). Legacy-фолбэк
 *    (version_id NULL из products.price) и ошибки БД → null → вызывающий
 *    маршрут использует products.price как раньше (поведение идентично).
 */

import type { Pool } from "pg";

/** Покрывающая now версия цены товара (variant NULL). */
export interface ResolvedPrice {
  versionId: string;
  amount: number;
  effectiveFrom: string | null; // ISO
}

/**
 * Best-effort catch-up эффективных цен (sync_effective_product_prices).
 * Вызывать ПЕРЕД резолвом/чтением цен; никогда не бросает.
 */
export async function syncEffectiveProductPricesSafe(pool: Pool): Promise<void> {
  try {
    await pool.query(`SELECT public.sync_effective_product_prices()`);
  } catch (e) {
    console.warn(
      "[price-version] sync_effective_product_prices failed (best-effort):",
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Резолв базовой цены товара на now через get_product_price_at.
 * Возвращает null (фолбэк на products.price) когда:
 *  - строка не вернулась / ошибка БД;
 *  - это legacy-фолбэк самой функции (version_id NULL);
 *  - amount не число.
 */
export async function resolveCurrentPriceSafe(
  pool: Pool,
  productId: string
): Promise<ResolvedPrice | null> {
  try {
    const res = await pool.query(
      `SELECT * FROM public.get_product_price_at($1, NULL, now())`,
      [productId]
    );
    const row = (res.rows || [])[0] as
      | {
          version_id: string | null;
          amount: number | string | null;
          effective_from: Date | string | null;
        }
      | undefined;
    if (!row || !row.version_id) return null; // legacy-фолбэк (products.price)
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) return null;
    return {
      versionId: String(row.version_id),
      amount,
      effectiveFrom: row.effective_from
        ? new Date(row.effective_from).toISOString()
        : null,
    };
  } catch (e) {
    console.warn(
      "[price-version] get_product_price_at failed (fallback to products.price):",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
