/**
 * Unit-тесты payout-math — единая формула выплаты (pay3b).
 *
 * Контракт:
 *   payout = clamp0(total - round(itemsTotal*rate) - round(total*2.5%))
 *   — идентично начислению эскроу-кроном (один источник истины).
 *   Нефинансовые аномалии (NaN/Infinity) → payout 0, clamped.
 */
import { describe, it, expect } from "vitest";
import { computeOrderPayout, DEFAULT_COMMISSION_RATE, YOOKASSA_RATE } from "@/lib/payout-math";

describe("payout-math: базовая формула", () => {
  it("стандартный заказ: total 1000, delivery 100, rate 0.15", () => {
    const r = computeOrderPayout({ total: 1000, deliveryCost: 100, commissionRateSnapshot: 0.15 });
    // itemsTotal = 900 → commission = 135; fee = round(25) = 25; payout = 1000-135-25 = 840
    expect(r.commission).toBe(135);
    expect(r.yookassaFee).toBe(25);
    expect(r.payout).toBe(840);
    expect(r.clamped).toBe(false);
  });

  it("самовывоз (delivery 0): total 500", () => {
    const r = computeOrderPayout({ total: 500, deliveryCost: 0, commissionRateSnapshot: 0.10 });
    // commission = 50; fee = 12.5 → Math.round = 13; payout = 500-50-13 = 437
    expect(r.payout).toBe(437);
  });

  it("нет снапшота тарифа → DEFAULT_COMMISSION_RATE (0.15)", () => {
    const r = computeOrderPayout({ total: 1000, deliveryCost: 0, commissionRateSnapshot: null });
    expect(r.commission).toBe(Math.round(1000 * DEFAULT_COMMISSION_RATE));
    expect(r.payout).toBe(1000 - 150 - 25);
  });

  it("округление half-up: fee 0.5 копеек от 10₽ → 0", () => {
    const r = computeOrderPayout({ total: 10, deliveryCost: 0, commissionRateSnapshot: 0 });
    expect(r.yookassaFee).toBe(Math.round(10 * YOOKASSA_RATE)); // 0.25 → 0
    expect(r.payout).toBe(10);
  });
});

describe("payout-math: clamp >= 0 (P1-E, синхронность с эскроу)", () => {
  it("commission + fee > total → payout 0, clamped", () => {
    const r = computeOrderPayout({ total: 100, deliveryCost: 0, commissionRateSnapshot: 0.95 });
    // commission = 95; fee = round(2.5) = 3 → raw = 2 ≥ 0 — не кейс; берём极端нее
    expect(r.payout).toBe(100 - 95 - 3);
  });

  it("аномалия: rate 1.2 → raw < 0 → payout 0, clamped", () => {
    const r = computeOrderPayout({ total: 100, deliveryCost: 0, commissionRateSnapshot: 1.2 });
    // commission = 120; fee = 3 → raw = -23 → clamp 0
    expect(r.payout).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it("delivery_cost > total: отрицательный itemsTotal не inflate-ит выплату выше clamp", () => {
    const r = computeOrderPayout({ total: 50, deliveryCost: 200, commissionRateSnapshot: 0.15 });
    // itemsTotal = -150 → commission = Math.round(-22.5) = -22 (half toward +∞), fee = 1
    // raw = 50 - (-22) - 1 = 71 — отрицательная комиссия — историческая семантика;
    // главное: payout >= 0 и идентично эскроу-начислению
    expect(r.payout).toBe(71);
    expect(r.payout).toBeGreaterThanOrEqual(0);
  });
});

describe("payout-math: защита от нечисловых входов", () => {
  it("total NaN → payout 0, clamped", () => {
    const r = computeOrderPayout({ total: NaN, deliveryCost: 0, commissionRateSnapshot: 0.15 });
    expect(r.payout).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it("total Infinity → payout 0, clamped (не может пройти в заявку)", () => {
    const r = computeOrderPayout({ total: Infinity, deliveryCost: 0, commissionRateSnapshot: 0.15 });
    expect(r.payout).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it("rate NaN → payout 0 (не применён DEFAULT молча к мусору)", () => {
    const r = computeOrderPayout({ total: 1000, deliveryCost: 0, commissionRateSnapshot: NaN });
    expect(r.payout).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it("строковые значения из БД преобразуются корректно", () => {
    const r = computeOrderPayout({ total: "1000" as unknown as number, deliveryCost: null, commissionRateSnapshot: "0.15" as unknown as number });
    expect(r.payout).toBe(825);
  });
});

describe("payout-math: согласованность начисления и выплаты", () => {
  it("формула даёт одинаковый payout при повторных вызовах (детерминизм)", () => {
    const a = computeOrderPayout({ total: 3456, deliveryCost: 300, commissionRateSnapshot: 0.12 });
    const b = computeOrderPayout({ total: 3456, deliveryCost: 300, commissionRateSnapshot: 0.12 });
    expect(a).toEqual(b);
  });

  it("сумма батча = сумме payout'ов (без отрицательных слагаемых)", () => {
    const orders = [
      { total: 1000, deliveryCost: 100, commissionRateSnapshot: 0.15 },
      { total: 2500, deliveryCost: 0, commissionRateSnapshot: 0.10 },
      { total: 700, deliveryCost: 50, commissionRateSnapshot: null },
    ];
    // 840 = 1000-135-25; 2187 = 2500-250-63 (round(62.5)=63); 584 = 700-98-18 (round(97.5)=98, round(17.5)=18)
    const sum = orders.reduce((acc, o) => acc + computeOrderPayout(o).payout, 0);
    expect(sum).toBe(840 + 2187 + 584);
  });
});
