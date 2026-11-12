/**
 * negotiation-binding.test.ts — Z-v32 Этап 8 (PR-5): юнит-тесты binding
 * индивидуального предложения (серверная фиксация согласованной цены).
 *
 * Единицы ЗАКРЕПЛЕНЫ: quoted_price — копейки, order_items.unit_price — рубли.
 */
import { describe, it, expect } from "vitest";
import {
  OFFER_VALIDITY_DEFAULT_DAYS,
  OFFER_VALIDITY_MAX_DAYS,
  OFFER_VALIDITY_MIN_DAYS,
  clampOfferValidityDays,
  offerValidUntilFrom,
  kopecksToRubles,
  validateNegotiationBinding,
  applyNegotiationPriceBinding,
  buildOfferBindingMeta,
  type NegotiationRecord,
} from "./negotiation-binding";

const DAY_MS = 24 * 60 * 60 * 1000;
const USER = "11111111-1111-4111-8111-111111111101";
const OTHER = "11111111-1111-4111-8111-111111111199";

function neg(overrides: Partial<NegotiationRecord> = {}): NegotiationRecord {
  return {
    id: "22222222-2222-4222-8222-222222222202",
    user_id: USER,
    status: "accepted",
    quoted_price: 250000, // копейки = 2500 ₽
    quoted_delivery_cost: 30000,
    valid_until: new Date(Date.now() + 5 * DAY_MS).toISOString(),
    ...overrides,
  };
}

describe("clampOfferValidityDays", () => {
  it("дефолт 14 дней (документированный)", () => {
    expect(OFFER_VALIDITY_DEFAULT_DAYS).toBe(14);
    expect(clampOfferValidityDays(undefined)).toBe(14);
    expect(clampOfferValidityDays(null)).toBe(14);
    expect(clampOfferValidityDays("abc")).toBe(14);
    expect(clampOfferValidityDays(NaN)).toBe(14);
  });

  it("custom срок клампится 1..60", () => {
    expect(OFFER_VALIDITY_MAX_DAYS).toBe(60);
    expect(OFFER_VALIDITY_MIN_DAYS).toBe(1);
    expect(clampOfferValidityDays(100)).toBe(60);
    expect(clampOfferValidityDays(60)).toBe(60);
    expect(clampOfferValidityDays(0)).toBe(1);
    expect(clampOfferValidityDays(-5)).toBe(1);
    expect(clampOfferValidityDays(30)).toBe(30);
    expect(clampOfferValidityDays(14.6)).toBe(15); // округление до целых дней
    expect(clampOfferValidityDays("45")).toBe(45); // строка-число допустима
  });
});

describe("offerValidUntilFrom", () => {
  it("сервер ставит now + дефолт/кламп от момента отправки", () => {
    const now = new Date("2026-02-01T12:00:00.000Z");
    expect(offerValidUntilFrom(now).getTime()).toBe(now.getTime() + 14 * DAY_MS);
    expect(offerValidUntilFrom(now, 100).getTime()).toBe(now.getTime() + 60 * DAY_MS);
    expect(offerValidUntilFrom(now, 3).getTime()).toBe(now.getTime() + 3 * DAY_MS);
  });
});

describe("kopecksToRubles (единственная точка конверсии)", () => {
  it("копейки -> рубли", () => {
    expect(kopecksToRubles(250000)).toBe(2500);
    expect(kopecksToRubles(12345)).toBeCloseTo(123.45, 10);
    expect(kopecksToRubles(0)).toBe(0);
  });
});

describe("validateNegotiationBinding", () => {
  it("нет записи -> 409 OFFER_NOT_ACCEPTED", () => {
    const d = validateNegotiationBinding(null, USER);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.httpStatus).toBe(409);
      expect(d.code).toBe("OFFER_NOT_ACCEPTED");
    }
  });

  it("чужие переговоры -> 403 NEGOTIATION_FORBIDDEN", () => {
    const d = validateNegotiationBinding(neg(), OTHER);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.httpStatus).toBe(403);
      expect(d.code).toBe("NEGOTIATION_FORBIDDEN");
    }
  });

  it("истёкшее (status='expired') -> 410 OFFER_EXPIRED + expiredAt", () => {
    const expiredAt = new Date(Date.now() - DAY_MS).toISOString();
    const d = validateNegotiationBinding(neg({ status: "expired", valid_until: expiredAt }), USER);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.httpStatus).toBe(410);
      expect(d.code).toBe("OFFER_EXPIRED");
      expect(d.expiredAt).toBe(expiredAt);
    }
  });

  it("не принятое предложение -> 409 OFFER_NOT_ACCEPTED", () => {
    for (const status of ["pending_confectioner", "quoted", "counter_offered", "declined"]) {
      const d = validateNegotiationBinding(neg({ status }), USER);
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.httpStatus).toBe(409);
    }
  });

  it("accepted без цены -> 409 OFFER_NO_PRICE", () => {
    const d = validateNegotiationBinding(neg({ quoted_price: null }), USER);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.httpStatus).toBe(409);
      expect(d.code).toBe("OFFER_NO_PRICE");
    }
  });

  it("accepted при valid_until в прошлом — ВАЛИДНО: фиксация произошла в accept", () => {
    // Документировано PR-5: истечение проверяется в момент accept (роут 410 +
    // триггер 0085); оформление после accept не отменяет согласованную цену.
    const d = validateNegotiationBinding(
      neg({ valid_until: new Date(Date.now() - 3600_000).toISOString() }),
      USER
    );
    expect(d.ok).toBe(true);
  });

  it("valid accepted -> ok", () => {
    const d = validateNegotiationBinding(neg(), USER);
    expect(d.ok).toBe(true);
  });
});

describe("applyNegotiationPriceBinding", () => {
  const productItem = { product_id: "p1", unit_price: 1000, quantity: 2, total: 2000 };
  const customItem = { product_id: null, unit_price: 999, quantity: 1, total: 999 };

  it("ноль custom-позиций -> 422 BINDING_ITEM_AMBIGUOUS", () => {
    const r = applyNegotiationPriceBinding([productItem], neg());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.httpStatus).toBe(422);
      expect(r.code).toBe("BINDING_ITEM_AMBIGUOUS");
    }
  });

  it("несколько custom-позиций -> 422 (честный отказ, не догадка)", () => {
    const r = applyNegotiationPriceBinding([customItem, customItem], neg());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.httpStatus).toBe(422);
  });

  it("единственная custom-позиция: unit_price = quoted_price/100 (рубли), total пересчитан", () => {
    const r = applyNegotiationPriceBinding([productItem, customItem], neg());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.boundItemIndex).toBe(1);
      expect(r.quotedPriceKopecks).toBe(250000);
      expect(r.quotedPriceRub).toBe(2500);
      // custom позиция перезаписана серверной ценой
      expect(r.items[1].unit_price).toBe(2500);
      expect(r.items[1].total).toBe(2500);
      // товарная позиция не тронута
      expect(r.items[0]).toEqual(productItem);
    }
  });

  it("quantity > 1: total = quotedPriceRub * quantity", () => {
    const r = applyNegotiationPriceBinding(
      [{ product_id: null, unit_price: 999, quantity: 3, total: 2997 }],
      neg()
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items[0].total).toBe(7500);
  });
});

describe("buildOfferBindingMeta", () => {
  it("аддитивная аудит-запись: negotiationId/revisionId/quotedPrice/validUntil", () => {
    const n = neg();
    const boundAt = new Date("2026-02-01T10:00:00.000Z");
    const meta = buildOfferBindingMeta({
      negotiation: n,
      quotedPriceRub: 2500,
      revisionId: "rev-1",
      boundAt,
    });
    expect(meta).toEqual({
      negotiationId: n.id,
      revisionId: "rev-1",
      quotedPrice: 250000, // копейки, как в negotiations
      quotedPriceRub: 2500, // рубли, как в order_items.unit_price
      quotedDeliveryCost: 30000,
      validUntil: n.valid_until,
      boundAt: boundAt.toISOString(),
    });
  });

  it("legacy-принятие без revision -> revisionId null, valid_until отсутствует -> null", () => {
    const meta = buildOfferBindingMeta({
      negotiation: neg({ valid_until: null, quoted_delivery_cost: null }),
      quotedPriceRub: 2500,
      revisionId: null,
      boundAt: new Date(),
    });
    expect(meta.revisionId).toBeNull();
    expect(meta.validUntil).toBeNull();
    expect(meta.quotedDeliveryCost).toBeNull();
  });
});
