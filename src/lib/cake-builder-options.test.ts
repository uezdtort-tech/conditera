/**
 * Unit-тесты для CAKE_BUILDER_OPTIONS.productTypes — типы кондитерских изделий.
 *
 * Тестируем:
 *   1. Все типы имеют обязательные поля (id, label, icon, description, unit, priceBase, steps)
 *   2. ID уникальны
 *   3. unit — только "порция" или "шт"
 *   4. steps содержат только валидные ключи
 *   5. defaultServings/defaultQuantity валидны для своего unit
 *   6. minServings ≤ defaultServings ≤ maxServings (для порций)
 *   7. minQuantity ≤ defaultQuantity ≤ maxQuantity (для штук)
 */
import { describe, it, expect } from "vitest";
import { CAKE_BUILDER_OPTIONS } from "@/lib/mock-data";

const VALID_STEP_KEYS = [
  "event",
  "base",
  "filling",
  "coating",
  "decor",
  "diet",
  "delivery",
  "summary",
] as const;

describe("CAKE_BUILDER_OPTIONS.productTypes", () => {
  const productTypes = CAKE_BUILDER_OPTIONS.productTypes;

  it("содержит минимум 5 типов изделий", () => {
    expect(productTypes.length).toBeGreaterThanOrEqual(5);
  });

  it("содержит торт как первый тип", () => {
    expect(productTypes[0].id).toBe("cake");
  });

  it("каждый тип имеет обязательные поля", () => {
    for (const pt of productTypes) {
      expect(pt).toHaveProperty("id");
      expect(pt).toHaveProperty("label");
      expect(pt).toHaveProperty("icon");
      expect(pt).toHaveProperty("description");
      expect(pt).toHaveProperty("unit");
      expect(pt).toHaveProperty("priceBase");
      expect(pt).toHaveProperty("steps");

      expect(typeof pt.id).toBe("string");
      expect(pt.id.length).toBeGreaterThan(0);
      expect(typeof pt.label).toBe("string");
      expect(pt.label.length).toBeGreaterThan(0);
      expect(typeof pt.icon).toBe("string");
      expect(typeof pt.description).toBe("string");
      expect(typeof pt.priceBase).toBe("number");
      expect(pt.priceBase).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(pt.steps)).toBe(true);
      expect(pt.steps.length).toBeGreaterThan(0);
    }
  });

  it("все ID уникальны", () => {
    const ids = productTypes.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("unit — только 'порция' или 'шт'", () => {
    for (const pt of productTypes) {
      expect(["порция", "шт"]).toContain(pt.unit);
    }
  });

  it("каждый шаг содержит только валидные ключи", () => {
    for (const pt of productTypes) {
      for (const step of pt.steps) {
        expect(VALID_STEP_KEYS).toContain(step);
      }
    }
  });

  it("каждый тип имеет шаги 'event', 'delivery', 'summary'", () => {
    for (const pt of productTypes) {
      expect(pt.steps).toContain("event");
      expect(pt.steps).toContain("delivery");
      expect(pt.steps).toContain("summary");
    }
  });

  it("'summary' — последний шаг у каждого типа", () => {
    for (const pt of productTypes) {
      expect(pt.steps[pt.steps.length - 1]).toBe("summary");
    }
  });
});

describe("CAKE_BUILDER_OPTIONS.productTypes — порционные изделия", () => {
  const portionTypes = CAKE_BUILDER_OPTIONS.productTypes.filter((p) => p.unit === "порция");

  it("имеют defaultServings, minServings, maxServings", () => {
    for (const pt of portionTypes) {
      expect(pt).toHaveProperty("defaultServings");
      expect(pt).toHaveProperty("minServings");
      expect(pt).toHaveProperty("maxServings");
    }
  });

  it("minServings ≤ defaultServings ≤ maxServings", () => {
    for (const pt of portionTypes) {
      const min = pt.minServings ?? 0;
      const def = pt.defaultServings ?? 0;
      const max = pt.maxServings ?? 0;
      expect(min).toBeLessThanOrEqual(def);
      expect(def).toBeLessThanOrEqual(max);
    }
  });

  it("minServings ≥ 1", () => {
    for (const pt of portionTypes) {
      expect(pt.minServings ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("торт поддерживает минимум 4 порции", () => {
    const cake = portionTypes.find((p) => p.id === "cake");
    expect(cake).toBeDefined();
    expect(cake?.minServings ?? 0).toBeGreaterThanOrEqual(4);
  });
});

describe("CAKE_BUILDER_OPTIONS.productTypes — штучные изделия", () => {
  const pieceTypes = CAKE_BUILDER_OPTIONS.productTypes.filter((p) => p.unit === "шт");

  it("имеют defaultQuantity, minQuantity, maxQuantity", () => {
    for (const pt of pieceTypes) {
      expect(pt).toHaveProperty("defaultQuantity");
      expect(pt).toHaveProperty("minQuantity");
      expect(pt).toHaveProperty("maxQuantity");
    }
  });

  it("minQuantity ≤ defaultQuantity ≤ maxQuantity", () => {
    for (const pt of pieceTypes) {
      const min = pt.minQuantity ?? 0;
      const def = pt.defaultQuantity ?? 0;
      const max = pt.maxQuantity ?? 0;
      expect(min).toBeLessThanOrEqual(def);
      expect(def).toBeLessThanOrEqual(max);
    }
  });

  it("minQuantity ≥ 1", () => {
    for (const pt of pieceTypes) {
      expect(pt.minQuantity ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("капкейки поддерживают минимум 6 штук", () => {
    const cupcakes = pieceTypes.find((p) => p.id === "cupcakes");
    expect(cupcakes).toBeDefined();
    expect(cupcakes?.minQuantity ?? 0).toBeGreaterThanOrEqual(6);
  });
});

describe("CAKE_BUILDER_OPTIONS.productTypes — доступные типы", () => {
  it("включает торт", () => {
    expect(CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "cake")).toBeDefined();
  });

  it("включает капкейки", () => {
    expect(CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "cupcakes")).toBeDefined();
  });

  it("включает макаронс", () => {
    expect(CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "macarons")).toBeDefined();
  });

  it("включает чизкейк", () => {
    expect(CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "cheesecake")).toBeDefined();
  });

  it("включает печенье", () => {
    expect(CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "cookies")).toBeDefined();
  });

  it("включает пряники", () => {
    expect(CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "gingerbread")).toBeDefined();
  });
});

describe("CAKE_BUILDER_OPTIONS.productTypes — цены", () => {
  it("цены положительные для всех типов", () => {
    for (const pt of CAKE_BUILDER_OPTIONS.productTypes) {
      expect(pt.priceBase).toBeGreaterThan(0);
    }
  });

  it("печенье и пряники — дешевле тортов", () => {
    const cake = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "cake");
    const cookies = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "cookies");
    const gingerbread = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "gingerbread");
    expect(cookies!.priceBase).toBeLessThan(cake!.priceBase);
    expect(gingerbread!.priceBase).toBeLessThan(cake!.priceBase);
  });

  it("муссовый торт дороже обычного (premium сегмент)", () => {
    const cake = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "cake");
    const mousseCake = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "mousse_cake");
    expect(mousseCake!.priceBase).toBeGreaterThan(cake!.priceBase);
  });
});

describe("CAKE_BUILDER_OPTIONS.productTypes — количество шагов", () => {
  it("торт имеет 8 шагов (максимум)", () => {
    const cake = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "cake");
    expect(cake?.steps.length).toBe(8);
  });

  it("макаронс имеет меньше шагов (без base и coating)", () => {
    const macarons = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "macarons");
    expect(macarons?.steps).not.toContain("base");
    expect(macarons?.steps).not.toContain("coating");
  });

  it("пряники имеют меньше шагов (без base, filling, coating)", () => {
    const gingerbread = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "gingerbread");
    expect(gingerbread?.steps).not.toContain("base");
    expect(gingerbread?.steps).not.toContain("filling");
    expect(gingerbread?.steps).not.toContain("coating");
  });
});
