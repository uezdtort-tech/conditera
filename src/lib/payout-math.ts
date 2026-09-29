/**
 * payout-math.ts — единая формула расчёта выплаты кондитеру по заказу.
 *
 * P1 (pay3b): раньше формула дублировалась в двух местах и РАСХОДИЛАСЬ:
 *   • src/app/api/cron/escrow-release/route.ts — начисление баланса,
 *     с clamp payout >= 0 (аномалия ценообразования не уводила баланс в минус);
 *   • src/app/api/payouts/request/route.ts — расчёт суммы заявки, БЕЗ clamp.
 * Заказ с commission + fee > total начислялся как 0, а в заявку попадал
 * с отрицательной суммой — расхождение «начислено ↔ запрошено к выплате».
 *
 * Теперь оба контура вызывают computeOrderPayout — один источник истины:
 * что начислено эскроу-кроном, то и доступно к выплате.
 *
 * Единицы: рубли (целые), установлено PAY-0 (см. 0034/0035 комментарии).
 * Округление: Math.round (half-up для положительных) — как прежде.
 */

export const YOOKASSA_RATE = 0.025; // 2.5% — эквайринг YooKassa
export const DEFAULT_COMMISSION_RATE = 0.15; // 15% — если снапшот не задан

export interface OrderPayoutInput {
  total: number | null;
  deliveryCost: number | null;
  /** commission_rate_snapshot заказа; null → DEFAULT_COMMISSION_RATE */
  commissionRateSnapshot: number | null;
}

export interface OrderPayoutBreakdown {
  /** Выплата кондитеру: total - commission - yookassaFee, clamp >= 0 */
  payout: number;
  /** Комиссия платформы (округлённая) */
  commission: number;
  /** Эквайринг YooKassa (округлённый) */
  yookassaFee: number;
  /** true — payout был ограничен 0 (commission+fee > total — аномалия) либо вход нечисловой */
  clamped: boolean;
}

/**
 * Расчёт выплаты по одному заказу из снапшотов заказа.
 * Защита от нечисловых входов (NaN/Infinity/строки из БД) — payout 0,
 * чтобы аномальная строка не могла ни inflate, ни уронить сумму батча.
 */
export function computeOrderPayout(input: OrderPayoutInput): OrderPayoutBreakdown {
  const total = Number(input.total);
  const deliveryCost = Number(input.deliveryCost ?? 0);
  const rate = Number(input.commissionRateSnapshot ?? DEFAULT_COMMISSION_RATE);

  if (
    !Number.isFinite(total) ||
    !Number.isFinite(deliveryCost) ||
    !Number.isFinite(rate)
  ) {
    return { payout: 0, commission: 0, yookassaFee: 0, clamped: true };
  }

  const itemsTotal = total - deliveryCost;
  const commission = Math.round(itemsTotal * rate);
  const yookassaFee = Math.round(total * YOOKASSA_RATE);

  const raw = total - commission - yookassaFee;
  const payout = Math.max(0, raw);

  return { payout, commission, yookassaFee, clamped: payout !== raw };
}
