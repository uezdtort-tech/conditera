/**
 * ZV33-4: тесты чистых хелперов индивидуальных предложений (offer-format.ts).
 *
 * Проверяются: конвертация копеек → «X ₽», форматирование valid_until в
 * Europe/Moscow (независимо от таймзоны среды), кламп срока действия 1..60,
 * определение истечения, метки change_reason, сборка CakeBuilderConfig
 * из снимка заявки для custom-позиции checkout.
 */
import { describe, it, expect } from "vitest";

import {
  formatOfferPrice,
  formatMoscowDateTime,
  formatMoscowDate,
  isOfferExpired,
  previewOfferValidUntil,
  clampOfferValidityDays,
  mapRevisionReason,
  buildInquiryBuilderConfig,
  cartItemDisplayUnitPrice,
} from "./offer-format";

describe("formatOfferPrice", () => {
  // ru-RU использует неразрывный пробел (U+00A0) как групповой разделитель
  const rub = (s: string) => s.replace(/\u00A0/g, " ");

  it("копейки → рубли в формате ru-RU", () => {
    expect(rub(formatOfferPrice(350000))).toBe("3 500 ₽");
    expect(rub(formatOfferPrice(100))).toBe("1 ₽");
    expect(rub(formatOfferPrice(0))).toBe("0 ₽");
  });

  it("некорректные значения → тире", () => {
    expect(formatOfferPrice(null)).toBe("—");
    expect(formatOfferPrice(undefined)).toBe("—");
    expect(formatOfferPrice(Number.NaN)).toBe("—");
  });
});

describe("formatMoscowDateTime / formatMoscowDate", () => {
  it("показывает дату в Europe/Moscow независимо от таймзоны среды", () => {
    // 2026-11-26T18:30:00Z = 21:30 МСК (зима, UTC+3)
    const iso = "2026-11-26T18:30:00.000Z";
    expect(formatMoscowDateTime(iso)).toContain("ноября");
    expect(formatMoscowDateTime(iso)).toContain("21:30");
    expect(formatMoscowDate(iso)).toContain("ноября");
    expect(formatMoscowDate(iso)).toContain("2026");
  });

  it("летом смещение тоже UTC+3 (МСК без перехода на летнее время)", () => {
    // 2026-07-01T09:00:00Z = 12:00 МСК
    expect(formatMoscowDateTime("2026-07-01T09:00:00.000Z")).toContain("12:00");
  });

  it("null / мусор → пустая строка", () => {
    expect(formatMoscowDateTime(null)).toBe("");
    expect(formatMoscowDateTime("not-a-date")).toBe("");
    expect(formatMoscowDate(undefined)).toBe("");
  });
});

describe("isOfferExpired", () => {
  const now = new Date("2026-11-26T12:00:00.000Z");

  it("истёкшее → true", () => {
    expect(isOfferExpired("2026-11-26T11:59:59.000Z", now)).toBe(true);
  });

  it("действующее и граница (равное now) → false", () => {
    expect(isOfferExpired("2026-11-26T12:00:01.000Z", now)).toBe(false);
    expect(isOfferExpired("2026-11-26T12:00:00.000Z", now)).toBe(false);
  });

  it("нет срока / мусор → false (гард на сервере вернёт 410)", () => {
    expect(isOfferExpired(null, now)).toBe(false);
    expect(isOfferExpired("garbage", now)).toBe(false);
  });
});

describe("previewOfferValidUntil / clampOfferValidityDays", () => {
  it("дефолт 14 дней", () => {
    const now = new Date("2026-11-26T12:00:00.000Z");
    expect(previewOfferValidUntil(undefined, now).getTime()).toBe(
      now.getTime() + 14 * 24 * 60 * 60 * 1000
    );
  });

  it("кламп 1..60 (0 → 1, 100 → 60, мусор → 14)", () => {
    expect(clampOfferValidityDays(0)).toBe(1);
    expect(clampOfferValidityDays(100)).toBe(60);
    expect(clampOfferValidityDays("abc")).toBe(14);
    expect(clampOfferValidityDays("30")).toBe(30);
  });

  it("клиентский кламп совпадает с серверным контрактом (1..60)", () => {
    const now = new Date("2026-11-26T12:00:00.000Z");
    expect(previewOfferValidUntil(60, now).getTime()).toBe(
      now.getTime() + 60 * 24 * 60 * 60 * 1000
    );
    expect(previewOfferValidUntil(61, now).getTime()).toBe(
      now.getTime() + 60 * 24 * 60 * 60 * 1000
    );
  });
});

describe("mapRevisionReason", () => {
  it("метки change_reason по ТЗ", () => {
    expect(mapRevisionReason("initial")).toBe("Первичное предложение");
    expect(mapRevisionReason("price_adjustment")).toBe("Обновление цены");
    expect(mapRevisionReason("counter_offer")).toBe("Встречное предложение");
    expect(mapRevisionReason("accepted")).toBe("Принято");
    expect(mapRevisionReason("discount_offered")).toBe("Скидка");
  });

  it("неизвестная/пустая причина — не падаем", () => {
    expect(mapRevisionReason("mystery")).toBe("mystery");
    expect(mapRevisionReason(null)).toBe("Изменение");
  });
});

describe("buildInquiryBuilderConfig", () => {
  it("собирает валидный CakeBuilderConfig из снимка заявки", () => {
    const cfg = buildInquiryBuilderConfig({
      event_type: "kids",
      base: "sponge",
      filling: "cream_cheese",
      coating: "chocolate",
      decorations: ["macarons"],
      dietary: [],
      servings: 12,
      city: "Москва",
      delivery_date: "2026-12-01",
      delivery_type: "delivery",
      inscription: "С днём рождения",
      comment: "Хочу торт с машинкой",
    });
    expect(cfg.productType).toBe("cake"); // снимок заявки не хранит product_type
    expect(cfg.base).toBe("sponge");
    expect(cfg.filling).toBe("cream_cheese");
    expect(cfg.servings).toBe(12);
    expect(cfg.quantity).toBe(1);
    expect(cfg.deliveryType).toBe("delivery");
    expect(cfg.decorations).toEqual(["macarons"]);
    expect(cfg.dietary).toBeUndefined(); // пустые списки не передаём
  });

  it("pickup → deliveryType pickup, пустые поля не ломают конфиг", () => {
    const cfg = buildInquiryBuilderConfig({
      event_type: null,
      base: null,
      filling: null,
      coating: null,
      decorations: null,
      dietary: null,
      servings: null,
      city: null,
      delivery_date: null,
      delivery_type: "pickup",
      inscription: null,
      comment: null,
    });
    expect(cfg.deliveryType).toBe("pickup");
    expect(cfg.productType).toBe("cake");
    expect(cfg.base).toBeUndefined();
  });
});

describe("cartItemDisplayUnitPrice (ZV33-4b D4 — честная цена при binding)", () => {
  const estimate = { price: 4060, agreedPriceRub: 15000 };

  it("binding active → показываем согласованную цену, а не estimate", () => {
    expect(cartItemDisplayUnitPrice(estimate, true)).toBe(15000);
    expect(cartItemDisplayUnitPrice({ price: 4060, agreedPriceRub: 0 }, true)).toBe(4060);
    expect(cartItemDisplayUnitPrice({ price: 4060, agreedPriceRub: null }, true)).toBe(4060);
    expect(cartItemDisplayUnitPrice({ price: 4060 }, true)).toBe(4060);
    // мусорная согласованная цена → fallback на estimate
    expect(cartItemDisplayUnitPrice({ price: 4060, agreedPriceRub: Number.NaN }, true)).toBe(4060);
    expect(cartItemDisplayUnitPrice({ price: 4060, agreedPriceRub: -100 }, true)).toBe(4060);
  });

  it("binding НЕ active (обычная корзина) → всегда estimate", () => {
    expect(cartItemDisplayUnitPrice(estimate, false)).toBe(4060);
    // даже если agreedPriceRub остался на позиции (привязку очистили на 4xx)
    expect(cartItemDisplayUnitPrice({ price: 2500, agreedPriceRub: 15000 }, false)).toBe(2500);
  });

  it("quantity учитывается вызывающим кодом: unit × qty", () => {
    // контракт для вызова: unit = cartItemDisplayUnitPrice(item, binding); итого = unit * quantity
    const unit = cartItemDisplayUnitPrice({ price: 4060, agreedPriceRub: 15000 }, true);
    expect(unit * 2).toBe(30000);
  });
});
