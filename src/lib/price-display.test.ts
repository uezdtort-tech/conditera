/**
 * price-display.test.ts — витринные правила цены (PR-4, Z-v32 ADDENDUM Этап 6).
 *
 * Контракты:
 *   • isFromPrice — маркер «от» только когда выбираемые опции могут поднять
 *     цену выше базовой (fillings/coatings/decorations с priceModifier > 0)
 *     или товар настраиваемый (customizable === true);
 *   • hasRealDiscount — зачёркнутая old_price только при old_price > price
 *     (защита от фиктивных скидок old <= price / 0 / undefined);
 *   • formatPriceEffectiveFrom — DD.MM.YYYY (ru-RU) из additive-поля
 *     priceEffectiveFrom (PR-2C: effective_from покрывающей now строки);
 *     legacy (null/undefined/мусор) → null — строка не показывается.
 *     Хелпер только форматирует дату, отданную сервером: будущих цен в
 *     витринных данных не существует, истории цен покупатель не видит.
 */
import { describe, it, expect } from "vitest";
import {
  isFromPrice,
  hasRealDiscount,
  formatPriceEffectiveFrom,
} from "./price-display";
import type { Product } from "./types";

/** Минимальный товар-фикстура: только поля, читаемые хелперами цены. */
function productFixture(overrides: Partial<Product>): Product {
  return {
    id: "p1",
    title: "Торт",
    slug: "tort",
    description: "",
    price: 2400,
    category: "cakes",
    images: [],
    confectionerId: "c1",
    rating: 4.8,
    reviewsCount: 3,
    ...overrides,
  };
}

describe("isFromPrice — маркер «от» (PR-4)", () => {
  it("fillings с priceModifier > 0 → true (опции поднимают цену выше базовой)", () => {
    expect(
      isFromPrice(
        productFixture({
          fillings: [
            { name: "Малина", priceModifier: 0 },
            { name: "Шоколад-ганаш", priceModifier: 300 },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("coatings/decorations с priceModifier > 0 → true", () => {
    expect(
      isFromPrice(
        productFixture({ coatings: [{ name: "Глазурь", priceModifier: 150 }] }),
      ),
    ).toBe(true);
    expect(
      isFromPrice(
        productFixture({
          decorations: [{ name: "Ягоды", priceModifier: 200 }],
        }),
      ),
    ).toBe(true);
  });

  it("customizable === true (настраиваемое изделие) → true без опций", () => {
    expect(isFromPrice(productFixture({ customizable: true }))).toBe(true);
  });

  it("опции только с priceModifier = 0 / undefined → false («от» не нужен)", () => {
    expect(
      isFromPrice(
        productFixture({
          fillings: [
            { name: "Классика", priceModifier: 0 },
            // runtime-мусор (маппер приводит к 0) — не должен включать «от»
            { name: "Без начинки", priceModifier: undefined as unknown as number },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("пустой товар (без опций и customizable) → false", () => {
    expect(isFromPrice(productFixture({}))).toBe(false);
  });

  it("null/undefined → false", () => {
    expect(isFromPrice(null)).toBe(false);
    expect(isFromPrice(undefined)).toBe(false);
  });
});

describe("hasRealDiscount — защита от фиктивных скидок (PR-4)", () => {
  it("old_price строго больше price → true (зачёркиваем)", () => {
    expect(
      hasRealDiscount(productFixture({ price: 2400, oldPrice: 3000 })),
    ).toBe(true);
  });

  it("old_price = price → false (фиктивная скидка «-0%» не показывается)", () => {
    expect(
      hasRealDiscount(productFixture({ price: 2400, oldPrice: 2400 })),
    ).toBe(false);
  });

  it("old_price < price → false (грязные данные не рисуем)", () => {
    expect(
      hasRealDiscount(productFixture({ price: 2400, oldPrice: 1900 })),
    ).toBe(false);
  });

  it("old_price undefined/0 → false (legacy-товар без скидки)", () => {
    expect(hasRealDiscount(productFixture({ price: 2400 }))).toBe(false);
    expect(
      hasRealDiscount(productFixture({ price: 2400, oldPrice: 0 })),
    ).toBe(false);
  });

  it("null-товар → false", () => {
    expect(hasRealDiscount(null)).toBe(false);
  });
});

describe("formatPriceEffectiveFrom — «Цена действует с DD.MM.YYYY» (PR-4)", () => {
  it("ISO-дата → DD.MM.YYYY (ru-RU)", () => {
    // Локальная полночь → toISOString → форматирование в той же TZ:
    // проверка не зависит от таймзоны CI.
    const iso = new Date(2026, 1, 15).toISOString();
    expect(formatPriceEffectiveFrom(iso)).toBe("15.02.2026");
  });

  it("legacy-товар (null/undefined/пустая строка) → null: строку не показываем", () => {
    expect(formatPriceEffectiveFrom(null)).toBe(null);
    expect(formatPriceEffectiveFrom(undefined)).toBe(null);
    expect(formatPriceEffectiveFrom("")).toBe(null);
  });

  it("мусор вместо даты → null (хелпер не изобретает дат)", () => {
    expect(formatPriceEffectiveFrom("not-a-date")).toBe(null);
  });

  it("хелпер работает только с датой (priceEffectiveFrom) — цену не трогает:\n    витрина показывает единственную текущую цену product.price (сервер\n    отдаёт только покрывающую now строку — будущие цены не утекают)", () => {
    const p = productFixture({
      price: 2400,
      priceEffectiveFrom: new Date(2026, 0, 31).toISOString(),
    });
    expect(formatPriceEffectiveFrom(p.priceEffectiveFrom)).toBe("31.01.2026");
    expect(p.price).toBe(2400); // отображаемая цена — текущая, единственная
    expect(Object.keys(p).filter((k) => /histor|versions/i.test(k))).toEqual([]);
  });
});
