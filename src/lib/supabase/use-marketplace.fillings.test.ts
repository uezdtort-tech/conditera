/**
 * use-marketplace.fillings.test.ts — mapApiProductToProduct: fillings (U-06).
 *
 * Рут-кауз U-06 (2-я точка): маппер витрины не переносил products.fillings
 * (jsonb, миграция 0043) в StoreProduct → гейт секции «Срезы торта по
 * начинкам» (product.fillings.length > 0) был мёртв для DB-товаров.
 *
 * Контракт нормализации (задокументированное решение):
 *   - fillings — ВСЕГДА массив: [] при отсутствии/null/не-массивном jsonb;
 *   - записи без строкового name отбрасываются;
 *   - priceModifier приводится к number, default 0 (не-finite → 0);
 *   - валидные записи проходят без потерь.
 */
import { describe, it, expect } from "vitest";
import { mapApiProductToProduct } from "./use-marketplace";
import type { ApiProduct } from "./use-marketplace";

function apiProduct(extra: Partial<ApiProduct> = {}): ApiProduct {
  return {
    id: "aaaaaaaa-0000-4000-8000-00000000000b",
    title: "Порционные десерты (20 шт.)",
    slug: "deserty-portSIONnyye-20",
    description: "Набор",
    price: 4400,
    old_price: null,
    weight_grams: null,
    servings: null,
    tags: [],
    rating_average: 0,
    reviews_count: 0,
    is_featured: false,
    images: [],
    confectioner: null,
    ...extra,
  };
}

describe("mapApiProductToProduct — fillings (регрессия U-06)", () => {
  it("валидыный jsonb-массив доезжает до StoreProduct.fillings без потерь", () => {
    const p = mapApiProductToProduct(
      apiProduct({
        fillings: [
          { name: "Шоколад-ганаш", priceModifier: 300 },
          { name: "Малина-базилик", priceModifier: 0 },
        ],
      })
    );
    expect(p.fillings).toEqual([
      { name: "Шоколад-ганаш", priceModifier: 300 },
      { name: "Малина-базилик", priceModifier: 0 },
    ]);
  });

  it("отсутствующее поле → [] (не undefined — гейт length > 0 честно закрыт)", () => {
    const p = mapApiProductToProduct(apiProduct({}));
    expect(p.fillings).toEqual([]);
  });

  it("null и пустой массив → []", () => {
    expect(mapApiProductToProduct(apiProduct({ fillings: null })).fillings).toEqual([]);
    expect(mapApiProductToProduct(apiProduct({ fillings: [] })).fillings).toEqual([]);
  });

  it("записи без строкового name отбрасываются", () => {
    const p = mapApiProductToProduct(
      apiProduct({
        fillings: [
          { name: "Валидная начинка", priceModifier: 100 },
          null as unknown as { name: string },
          { priceModifier: 5 } as unknown as { name: string },
          { name: 42 } as unknown as { name: string },
        ],
      })
    );
    expect(p.fillings).toEqual([{ name: "Валидная начинка", priceModifier: 100 }]);
  });

  it("priceModifier приводится к number; отсутствующий/не-finite → 0", () => {
    const p = mapApiProductToProduct(
      apiProduct({
        fillings: [
          { name: "Без модификатора" },
          { name: "Строковый модификатор", priceModifier: "150" as unknown as number },
          { name: "Мусор", priceModifier: "abc" as unknown as number },
        ],
      })
    );
    expect(p.fillings).toEqual([
      { name: "Без модификатора", priceModifier: 0 },
      { name: "Строковый модификатор", priceModifier: 150 },
      { name: "Мусор", priceModifier: 0 },
    ]);
  });

  it("не-массивный jsonb (мусор) → []", () => {
    const p = mapApiProductToProduct(
      apiProduct({ fillings: { name: "не массив" } as unknown as ApiProduct["fillings"] })
    );
    expect(p.fillings).toEqual([]);
  });
});
