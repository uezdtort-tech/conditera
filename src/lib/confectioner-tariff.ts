/**
 * confectioner-tariff.ts — ЕДИНЫЙ источник тарифных ставок комиссии и хелпер
 * снапшота кондитера для путей создания заказа (POST /api/checkout,
 * POST /api/orders). Раньше ставки дублировались/расходились между маршрутами,
 * а снапшот в /api/orders искал confectioners по неверной колонке
 * (id TEXT против UUID пользователя) — commission_rate_snapshot был null у
 * всех заказов, payout-math молча падала в DEFAULT_COMMISSION_RATE.
 *
 * Инвариант: ищем confectioners по "userId" (= auth.users UUID из
 * products.confectioner_id) и только verificationStatus='approved';
 * не approved / не найден → снапшоты null (payout-math применит дефолт),
 * заказ НЕ блокируется.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export const TARIFF_RATES: Record<string, number> = {
  START: 0.15,
  PROFI: 0.1,
  PREMIUM: 0.05,
  BASIC: 0.15,
  BUSINESS: 0.08,
};

export const DEFAULT_COMMISSION_RATE = 0.15;

export interface ConfectionerOrderSnapshot {
  tariffSnapshot: string | null;
  commissionRateSnapshot: number | null;
  legalStatusSnapshot: string | null;
}

/**
 * Снапшот тарифа/комиссии/legal для заказа по UUID пользователя-кондитера.
 * Безопасен: любая ошибка → null-снапшот (заказ создаётся с дефолтной ставкой).
 */
export async function loadConfectionerOrderSnapshot(
  confectionerUserId: string | null
): Promise<ConfectionerOrderSnapshot> {
  if (!confectionerUserId) {
    return { tariffSnapshot: null, commissionRateSnapshot: null, legalStatusSnapshot: null };
  }
  try {
    const { data: conf } = await supabaseAdmin
      .from("confectioners")
      .select("tariff, legalInfo")
      .eq("userId", confectionerUserId)
      .eq("verificationStatus", "approved")
      .maybeSingle();
    if (!conf) {
      return { tariffSnapshot: null, commissionRateSnapshot: null, legalStatusSnapshot: null };
    }
    const tariffSnapshot = String(conf.tariff || "BASIC");
    const commissionRateSnapshot = TARIFF_RATES[tariffSnapshot] ?? DEFAULT_COMMISSION_RATE;
    const legalInfo = (conf.legalInfo as { status?: string } | null) || null;
    return {
      tariffSnapshot,
      commissionRateSnapshot,
      legalStatusSnapshot: legalInfo?.status || null,
    };
  } catch {
    return { tariffSnapshot: null, commissionRateSnapshot: null, legalStatusSnapshot: null };
  }
}
