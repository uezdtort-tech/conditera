/**
 * Unit-тесты для src/lib/cake-builder-pricing.ts — ЕДИНОЙ формулы цены
 * конструктора (клиент cake-builder-page + store.addToCart(custom) + сервер
 * POST /api/checkout обязаны считать по ней ОДНУ и ту же цену).
 *
 * Проверяем:
 *   1. Формулу цены (база + начинка/покрытие/декор, порции/штуки) — 1:1 с клиентом.
 *   2. Региональный коэффициент города (Москва 1.4).
 *   3. Валидацию конфига (обязательные поля, quantity/servings 1..999).
 *   4. Защиту от отрицательной/некорректной цены.
 *   5. Неизвестные модификаторы (начинка/декор) — invalid (сервер → 422).
 *   6. Человекочитаемое описание custom-позиции.
 */
import { describe, it, expect } from "vitest";
import {
  calculateBuilderUnitPrice,
  calculateBuilderPrice,
  validateBuilderConfig,
  describeBuilderConfig,
  builderConfigParams,
  mergeBuilderFillings,
  getMockBuilderFillings,
  BUILDER_MAX_QUANTITY,
  type CakeBuilderConfig,
} from "@/lib/cake-builder-pricing";
import { CAKE_BUILDER_OPTIONS } from "@/lib/mock-data";

// Москва = 1.4 (см. BASE_CITY_PRICING в regional-pricing) — используется в тестах.
const MOCK_CITY = "Москва";

describe("calculateBuilderUnitPrice — формула 1:1 с клиентом", () => {
  it("торт: база + начинка + покрытие + декор + порции сверх minServings", () => {
    // cake: priceBase 1500, minServings 4; sponge 0; chocolate_ganache 350;
    // ganache_dark 250; berries 400 → unit 2500 + (12−4)×180 = 3940
    const cfg: CakeBuilderConfig = {
      productType: "cake",
      base: "sponge",
      filling: "chocolate_ganache",
      coating: "ganache_dark",
      decorations: ["berries"],
      servings: 12,
    };
    expect(calculateBuilderUnitPrice(cfg)).toBe(2500 + 8 * 180);
  });

  it("порции не выше minServings не дают надбавки", () => {
    const cfg: CakeBuilderConfig = { productType: "cake", servings: 4 };
    expect(calculateBuilderUnitPrice(cfg)).toBe(1500);
    const below: CakeBuilderConfig = { productType: "cake", servings: 2 };
    expect(calculateBuilderUnitPrice(below)).toBe(1500);
  });

  it("неизвестный productType → null (валидация отдаст 422)", () => {
    expect(calculateBuilderUnitPrice({ productType: "nonexistent" })).toBeNull();
  });

  it("без servings — берётся defaultServings типа изделия", () => {
    const cake = CAKE_BUILDER_OPTIONS.productTypes.find((p) => p.id === "cake")!;
    const price = calculateBuilderUnitPrice({ productType: "cake" })!;
    expect(price).toBe(1500 + Math.max(0, (cake.defaultServings || 8) - 4) * 180);
  });

  it("штучные изделия: unit × quantity", () => {
    // cupcakes: priceBase 200/шт
    expect(calculateBuilderUnitPrice({ productType: "cupcakes", quantity: 12 })).toBe(2400);
    expect(calculateBuilderUnitPrice({ productType: "cupcakes" })).toBe(200 * 12); // defaultQuantity 12
  });

  it("основа с надбавкой учитывается (mousse +400)", () => {
    expect(calculateBuilderUnitPrice({ productType: "cake", base: "mousse" })).toBe(
      1500 + 400 + Math.max(0, 8 - 4) * 180
    );
  });

  it("несколько декоров суммируются", () => {
    // berries 400 + edible_gold 600
    const cfg: CakeBuilderConfig = {
      productType: "cake",
      servings: 4,
      decorations: ["berries", "edible_gold"],
    };
    expect(calculateBuilderUnitPrice(cfg)).toBe(1500 + 400 + 600);
  });

  it("динамические начинки (из БД) переопределяют mock", () => {
    const cfg: CakeBuilderConfig = { productType: "cake", filling: "db_filling", servings: 4 };
    const opts = { fillings: [{ id: "db_filling", label: "Фисташка", price: 500 }] };
    expect(calculateBuilderUnitPrice(cfg, opts)).toBe(2000);
  });
});

describe("calculateBuilderPrice — региональный коэффициент", () => {
  it("Москва: × 1.4 с округлением", () => {
    const base = calculateBuilderUnitPrice({ productType: "cake", servings: 4 })!; // 1500
    expect(calculateBuilderPrice({ productType: "cake", servings: 4, city: MOCK_CITY })).toBe(
      Math.round(base * 1.4)
    );
  });

  it("неизвестный город — базовая цена", () => {
    expect(calculateBuilderPrice({ productType: "cake", servings: 4, city: "Заря" })).toBe(1500);
  });
});

describe("validateBuilderConfig", () => {
  it("валидный минимальный конфиг", () => {
    expect(validateBuilderConfig({ productType: "cake" }).valid).toBe(true);
  });

  it("не объект / пусто → invalid", () => {
    expect(validateBuilderConfig(null).valid).toBe(false);
    expect(validateBuilderConfig("cake").valid).toBe(false);
    expect(validateBuilderConfig([]).valid).toBe(false);
    expect(validateBuilderConfig({}).valid).toBe(false); // нет productType
  });

  it("неизвестный productType → invalid", () => {
    const r = validateBuilderConfig({ productType: "ufo" });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("тип изделия");
  });

  it("неизвестная начинка → invalid (сервер вернёт 422, не молчаливо проигнорит)", () => {
    const r = validateBuilderConfig({ productType: "cake", filling: "hack_filling" });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("начинка");
  });

  it("начинка из переданного списка БД валидна", () => {
    const opts = { fillings: [{ id: "db1", label: "Сливочная", price: 100 }] };
    expect(validateBuilderConfig({ productType: "cake", filling: "db1" }, opts).valid).toBe(true);
  });

  it("неизвестные основа/покрытие/декор → invalid", () => {
    expect(validateBuilderConfig({ productType: "cake", base: "wood" }).valid).toBe(false);
    expect(validateBuilderConfig({ productType: "cake", coating: "plastic" }).valid).toBe(false);
    expect(validateBuilderConfig({ productType: "cake", decorations: ["nails"] }).valid).toBe(false);
  });

  it("decorations/dietary не массив → invalid", () => {
    expect(
      validateBuilderConfig({ productType: "cake", decorations: "berries" as unknown as string[] }).valid
    ).toBe(false);
    expect(
      validateBuilderConfig({ productType: "cake", dietary: "vegan" as unknown as string[] }).valid
    ).toBe(false);
  });

  it("quantity/servings — целые 1..999", () => {
    expect(validateBuilderConfig({ productType: "cupcakes", quantity: 0 }).valid).toBe(false);
    expect(validateBuilderConfig({ productType: "cupcakes", quantity: 1 }).valid).toBe(true);
    expect(
      validateBuilderConfig({ productType: "cupcakes", quantity: BUILDER_MAX_QUANTITY }).valid
    ).toBe(true);
    expect(
      validateBuilderConfig({ productType: "cupcakes", quantity: BUILDER_MAX_QUANTITY + 1 }).valid
    ).toBe(false);
    expect(validateBuilderConfig({ productType: "cake", servings: 12.5 }).valid).toBe(false);
  });

  it("надпись длиннее 100 символов → invalid", () => {
    expect(
      validateBuilderConfig({ productType: "cake", inscription: "А".repeat(101) }).valid
    ).toBe(false);
  });

  it("отрицательная цена невозможна на справочнике, но защита срабатывает через инъекцию", () => {
    // Инъекция начинки с огромной отрицательной ценой (скомпрометированный справочник)
    const opts = { fillings: [{ id: "poison", label: "Poison", price: -999999 }] };
    const r = validateBuilderConfig({ productType: "cake", filling: "poison", servings: 4 }, opts);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("неотрицательную");
  });

  it("цена NaN защищена: " + "некорректные поля конфига отбрасываются валидацией", () => {
    // servings: NaN не является integer → invalid
    expect(validateBuilderConfig({ productType: "cake", servings: Number.NaN }).valid).toBe(false);
  });
});

describe("describeBuilderConfig / builderConfigParams", () => {
  it("заголовок содержит тип изделия и параметры", () => {
    const title = describeBuilderConfig({
      productType: "cake",
      base: "sponge",
      filling: "raspberry",
      decorations: ["berries"],
      servings: 12,
    });
    expect(title).toContain("Торт на заказ");
    expect(title).toContain("Малиновый конфитюр");
    expect(title).toContain("12 порций");
  });

  it("без опций — просто «Торт на заказ»", () => {
    expect(describeBuilderConfig({ productType: "cake" })).toBe("Торт на заказ");
  });

  it("builderConfigParams возвращает пары для корзины", () => {
    const params = builderConfigParams({
      productType: "cake",
      base: "sponge",
      coating: "mastic",
      inscription: "С днём рождения!",
    });
    const map = Object.fromEntries(params.map((p) => [p.label, p.value]));
    expect(map["Основа"]).toBe("Бисквит");
    expect(map["Покрытие"]).toBe("Сахарная мастика");
    expect(map["Надпись"]).toBe("С днём рождения!");
  });
});

describe("mergeBuilderFillings", () => {
  it("mock-справочник не пуст и содержит базовые начинки", () => {
    const fillings = getMockBuilderFillings();
    expect(fillings.length).toBeGreaterThanOrEqual(8);
    expect(fillings.find((f) => f.id === "chocolate_ganache")?.price).toBe(350);
  });

  it("DB-строки маппятся как в клиенте: price_multiplier 1.3 → 300", () => {
    const merged = mergeBuilderFillings([
      { id: "db1", name: "Фисташковый крем", price_multiplier: 1.3 },
      { id: "db2", name: "Классика", price_multiplier: 1 },
    ]);
    expect(merged.find((f) => f.id === "db1")?.price).toBe(300);
    expect(merged.find((f) => f.id === "db2")?.price).toBe(0);
    // mock-начинки сохранены
    expect(merged.find((f) => f.id === "chocolate_ganache")).toBeDefined();
  });

  it("битые DB-строки не ломают слияние", () => {
    const merged = mergeBuilderFillings([
      null as unknown as { id: string; name: string; price_multiplier: number },
      { id: "ok", name: "Ок", price_multiplier: 1.1 },
    ]);
    expect(merged.find((f) => f.id === "ok")).toBeDefined();
  });
});
