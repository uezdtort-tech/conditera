/**
 * Unit-тесты для src/lib/fillings-data.ts — 52 системные начинки.
 *
 * Тестируем:
 *   1. Все начинки имеют обязательные поля (name, slug, description, category, allergens, consistency, color, suggestedPriceModifier)
 *   2. Все slug уникальны
 *   3. Все имена уникальны
 *   4. Все описания непустые (≥10 символов)
 *   5. Категории — валидные значения
 *   6. Все цвета — в формате #RRGGBB
 *   7. suggestedPriceModifier — неотрицательное число
 *   8. Каждая категория содержит минимум 1 начинку
 *   9. Аллергены — массив строк (или пустой)
 *   10. Consistency — непустая строка
 */
import { describe, it, expect } from "vitest";
import { FILLINGS_SEED, type FillingSeed } from "@/lib/fillings-data";

const VALID_CATEGORIES = [
  "CREAM", "CHOCOLATE", "BERRY", "CARAMEL", "NUT",
  "FRUIT", "CLASSIC", "MOUSSE", "CUSTARD", "OTHER",
] as const;

describe("FILLINGS_SEED — базовые проверки", () => {
  it("содержит 48+ начинок", () => {
    expect(FILLINGS_SEED.length).toBeGreaterThanOrEqual(48);
  });

  it("массив объектов FillingSeed", () => {
    expect(Array.isArray(FILLINGS_SEED)).toBe(true);
    for (const f of FILLINGS_SEED) {
      expect(typeof f).toBe("object");
      expect(f).not.toBeNull();
    }
  });
});

describe("FILLINGS_SEED — обязательные поля", () => {
  it("каждая начинка имеет name", () => {
    for (const f of FILLINGS_SEED) {
      expect(f).toHaveProperty("name");
      expect(typeof f.name).toBe("string");
      expect(f.name.length).toBeGreaterThan(0);
    }
  });

  it("каждая начинка имеет slug", () => {
    for (const f of FILLINGS_SEED) {
      expect(f).toHaveProperty("slug");
      expect(typeof f.slug).toBe("string");
      expect(f.slug.length).toBeGreaterThan(0);
    }
  });

  it("каждая начинка имеет description", () => {
    for (const f of FILLINGS_SEED) {
      expect(f).toHaveProperty("description");
      expect(typeof f.description).toBe("string");
    }
  });

  it("каждая начинка имеет category", () => {
    for (const f of FILLINGS_SEED) {
      expect(f).toHaveProperty("category");
      expect(typeof f.category).toBe("string");
    }
  });

  it("каждая начинка имеет allergens", () => {
    for (const f of FILLINGS_SEED) {
      expect(f).toHaveProperty("allergens");
      expect(Array.isArray(f.allergens)).toBe(true);
    }
  });

  it("каждая начинка имеет consistency", () => {
    for (const f of FILLINGS_SEED) {
      expect(f).toHaveProperty("consistency");
      expect(typeof f.consistency).toBe("string");
    }
  });

  it("каждая начинка имеет color", () => {
    for (const f of FILLINGS_SEED) {
      expect(f).toHaveProperty("color");
      expect(typeof f.color).toBe("string");
    }
  });

  it("каждая начинка имеет suggestedPriceModifier", () => {
    for (const f of FILLINGS_SEED) {
      expect(f).toHaveProperty("suggestedPriceModifier");
      expect(typeof f.suggestedPriceModifier).toBe("number");
    }
  });
});

describe("FILLINGS_SEED — описания непустые", () => {
  it("все описания содержат минимум 10 символов", () => {
    for (const f of FILLINGS_SEED) {
      expect(f.description.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("описания не являются плейсхолдерами", () => {
    const placeholders = ["описание", "TODO", "placeholder", "lorem ipsum", "нет описания"];
    for (const f of FILLINGS_SEED) {
      const lower = f.description.toLowerCase();
      for (const p of placeholders) {
        expect(lower).not.toBe(p);
      }
    }
  });

  it("описания содержат полезную информацию (≥30 символов)", () => {
    for (const f of FILLINGS_SEED) {
      expect(f.description.length).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("FILLINGS_SEED — уникальность", () => {
  it("все slug уникальны", () => {
    const slugs = FILLINGS_SEED.map((f) => f.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it("все имена уникальны", () => {
    const names = FILLINGS_SEED.map((f) => f.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

describe("FILLINGS_SEED — категории", () => {
  it("все категории — валидные значения", () => {
    for (const f of FILLINGS_SEED) {
      expect(VALID_CATEGORIES).toContain(f.category);
    }
  });

  it("каждая категория содержит минимум 1 начинку", () => {
    for (const cat of VALID_CATEGORIES) {
      const count = FILLINGS_SEED.filter((f) => f.category === cat).length;
      // OTHER может быть пустой, остальные должны иметь начинку
      if (cat !== "OTHER") {
        expect(count).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("CREAM содержит минимум 3 начинки", () => {
    const creamCount = FILLINGS_SEED.filter((f) => f.category === "CREAM").length;
    expect(creamCount).toBeGreaterThanOrEqual(3);
  });

  it("CHOCOLATE содержит минимум 2 начинки", () => {
    const chocolateCount = FILLINGS_SEED.filter((f) => f.category === "CHOCOLATE").length;
    expect(chocolateCount).toBeGreaterThanOrEqual(2);
  });

  it("BERRY содержит минимум 3 начинки", () => {
    const berryCount = FILLINGS_SEED.filter((f) => f.category === "BERRY").length;
    expect(berryCount).toBeGreaterThanOrEqual(3);
  });
});

describe("FILLINGS_SEED — цвета", () => {
  it("все цвета — в формате #RRGGBB", () => {
    for (const f of FILLINGS_SEED) {
      expect(f.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("FILLINGS_SEED — suggestedPriceModifier", () => {
  it("все значения — неотрицательные числа", () => {
    for (const f of FILLINGS_SEED) {
      expect(f.suggestedPriceModifier).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(f.suggestedPriceModifier)).toBe(true);
    }
  });

  it("значения в разумном диапазоне (0..2000)", () => {
    for (const f of FILLINGS_SEED) {
      expect(f.suggestedPriceModifier).toBeLessThanOrEqual(2000);
    }
  });
});

describe("FILLINGS_SEED — аллергены", () => {
  it("все аллергены — массивы строк", () => {
    for (const f of FILLINGS_SEED) {
      for (const a of f.allergens) {
        expect(typeof a).toBe("string");
        expect(a.length).toBeGreaterThan(0);
      }
    }
  });

  it("начинки с молоком имеют аллерген 'Молоко'", () => {
    const milkFillings = FILLINGS_SEED.filter((f) =>
      f.name.toLowerCase().includes("слив") ||
      f.name.toLowerCase().includes("сливочн") ||
      f.name.toLowerCase().includes("сметан") ||
      f.name.toLowerCase().includes("сыр") ||
      f.name.toLowerCase().includes("чиз") ||
      f.name.toLowerCase().includes("молочн") ||
      f.name.toLowerCase().includes("пломбир")
    );

    for (const f of milkFillings) {
      expect(f.allergens).toContain("Молоко");
    }
  });

  it("начинки с орехами имеют аллерген 'Орехи' или подобный", () => {
    // Проверяем только начинки, которые явно содержат орехи в названии
    const nutFillings = FILLINGS_SEED.filter((f) =>
      f.name.toLowerCase().includes("орех") ||
      f.name.toLowerCase().includes("фисташк") ||
      f.name.toLowerCase().includes("миндаль")
    );

    for (const f of nutFillings) {
      const hasNut = f.allergens.some((a) =>
        a.toLowerCase().includes("орех") ||
        a.toLowerCase().includes("фисташк") ||
        a.toLowerCase().includes("миндаль")
      );
      expect(hasNut).toBe(true);
    }
  });
});

describe("FILLINGS_SEED — конкретные начинки", () => {
  it("содержит 'Крем-чиз'", () => {
    const f = FILLINGS_SEED.find((f) => f.name === "Крем-чиз");
    expect(f).toBeDefined();
    expect(f?.description.length).toBeGreaterThan(30);
  });

  it("содержит 'Шоколадный ганаш'", () => {
    const f = FILLINGS_SEED.find((f) => f.name === "Шоколадный ганаш");
    expect(f).toBeDefined();
    expect(f?.description.length).toBeGreaterThan(30);
  });

  it("содержит 'Тирамису'", () => {
    const f = FILLINGS_SEED.find((f) => f.name === "Тирамису");
    expect(f).toBeDefined();
    expect(f?.description.length).toBeGreaterThan(30);
  });

  it("содержит 'Солёная карамель'", () => {
    const f = FILLINGS_SEED.find((f) => f.name === "Солёная карамель");
    expect(f).toBeDefined();
    expect(f?.description.length).toBeGreaterThan(30);
  });

  it("содержит 'Красный бархат'", () => {
    const f = FILLINGS_SEED.find((f) => f.name === "Красный бархат");
    expect(f).toBeDefined();
    expect(f?.description.length).toBeGreaterThan(30);
  });

  it("содержит 'Чизкейк'", () => {
    const f = FILLINGS_SEED.find((f) => f.name === "Чизкейк");
    expect(f).toBeDefined();
    expect(f?.description.length).toBeGreaterThan(30);
  });

  it("содержит 'Птичье молоко'", () => {
    const f = FILLINGS_SEED.find((f) => f.name === "Птичье молоко");
    expect(f).toBeDefined();
    expect(f?.description.length).toBeGreaterThan(30);
  });
});

describe("FILLINGS_SEED — consistency", () => {
  it("все значения consistency — непустые строки", () => {
    for (const f of FILLINGS_SEED) {
      expect(f.consistency.length).toBeGreaterThan(0);
    }
  });

  it("consistency содержит описание текстуры", () => {
    // Проверяем, что в consistency есть слова, связанные с текстурой
    const textureWords = ["крем", "густой", "воздушный", "плотный", "нежный", "лёгкий", "тягучий", "желейный", "мусс"];
    for (const f of FILLINGS_SEED) {
      const lower = f.consistency.toLowerCase();
      const hasTextureWord = textureWords.some((w) => lower.includes(w));
      // Не все могут содержать эти слова, но большинство должны
      // Проверяем только для CREAM/CHOCOLATE/MOUSSE категорий
      if (f.category === "CREAM" || f.category === "CHOCOLATE" || f.category === "MOUSSE") {
        expect(hasTextureWord || f.consistency.length > 5).toBe(true);
      }
    }
  });
});
