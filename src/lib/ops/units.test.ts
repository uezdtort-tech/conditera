/**
 * units.test.ts — регрессия конвертации кулинарных единиц (приёмка Z-v12).
 *
 * Лочит:
 *   • г↔кг, мл↔л, шт↔дес (алиасы десятков добавлены в Z-v12: склад хранит
 *     яйца в «дес», рецепты считают в «шт» — без алиаса позиция молча
 *     уходила в unit_mismatch и выпадала из проверки остатков);
 *   • несовместимые измерения → null;
 *   • неизвестные единицы → null.
 */
import { describe, it, expect } from "vitest";
import { convertQty, normalizeUnit } from "./units";

describe("convertQty — масса", () => {
  it("г → кг", () => {
    expect(convertQty(450, "г", "кг")).toBe(0.45);
  });
  it("кг → г", () => {
    expect(convertQty(25, "кг", "г")).toBe(25000);
  });
  it("алиасы «гр»/«грамм» равнозначны", () => {
    expect(convertQty(100, "гр", "грамм")).toBe(100);
  });
});

describe("convertQty — объём", () => {
  it("мл → л", () => {
    expect(convertQty(600, "мл", "л")).toBe(0.6);
  });
  it("л → мл", () => {
    expect(convertQty(7, "л", "мл")).toBe(7000);
  });
});

describe("convertQty — штуки и десятки (Z-v12)", () => {
  it("шт → дес: 8 яиц = 0.8 десятка", () => {
    expect(convertQty(8, "шт", "дес")).toBe(0.8);
  });
  it("дес → шт: склад 15 дес = 150 шт", () => {
    expect(convertQty(15, "дес", "шт")).toBe(150);
  });
  it("норма на 1 торт ×2 = 16 шт = 1.6 дес", () => {
    expect(convertQty(8 * 2, "шт", "дес")).toBe(1.6);
  });
  it("десяток/десятки/dozen — те же алиасы", () => {
    expect(convertQty(1, "десяток", "десятки")).toBe(1);
    expect(convertQty(1, "dozen", "шт")).toBe(10);
  });
});

describe("convertQty — несовместимость и мусор", () => {
  it("г → мл → null (разные измерения)", () => {
    expect(convertQty(1, "г", "мл")).toBeNull();
  });
  it("шт → кг → null", () => {
    expect(convertQty(5, "шт", "кг")).toBeNull();
  });
  it("неизвестная единица → null", () => {
    expect(convertQty(1, "чашка", "г")).toBeNull();
  });
  it("NaN → null", () => {
    expect(convertQty(NaN, "г", "кг")).toBeNull();
  });
  it("без «плавающей пыли»", () => {
    expect(convertQty(0.1 + 0.2, "г", "г")).toBe(0.3);
  });
});

describe("normalizeUnit", () => {
  it("л → мл (канон объёма, factor в convertQty)", () => {
    expect(normalizeUnit("л")).toBe("мл");
  });
  it("дес → шт", () => {
    expect(normalizeUnit("Дес")).toBe("шт");
  });
  it("неизвестное → null", () => {
    expect(normalizeUnit("стакан")).toBeNull();
  });
});
