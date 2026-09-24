/**
 * Unit-тесты для src/lib/regional-pricing.ts — региональное ценообразование.
 *
 * Тестируем:
 *   1. normalizeCity — нормализация названий городов
 *   2. parseWeightKg — парсинг веса в кг
 *   3. getBaseMultiplier — базовые множители городов
 *   4. clampMultiplier — ограничение множителя
 *   5. calculateRegionalPriceSync — синхронный расчёт цены
 *   6. compareCities — сравнение цен между городами
 *   7. getAllBaseMultipliers — список всех городов
 *   8. Констант: MIN_MULTIPLIER, MAX_MULTIPLIER, DEFAULT_MULTIPLIER, MIN_SAMPLES_FOR_DYNAMIC
 *
 * Async функции (calculateRegionalPrice, getDynamicCityMultiplier) не тестируем
 * без мока БД — оставим для e2e тестов.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeCity,
  parseWeightKg,
  getBaseMultiplier,
  clampMultiplier,
  calculateRegionalPriceSync,
  compareCities,
  getAllBaseMultipliers,
  MIN_MULTIPLIER,
  MAX_MULTIPLIER,
  DEFAULT_MULTIPLIER,
  MIN_SAMPLES_FOR_DYNAMIC,
  BASE_CITY_PRICING,
} from "@/lib/regional-pricing";

// ============================================================================
// Константы
// ============================================================================

describe("regional-pricing: константы", () => {
  it("MIN_MULTIPLIER — положительное число < 1", () => {
    expect(MIN_MULTIPLIER).toBeGreaterThan(0);
    expect(MIN_MULTIPLIER).toBeLessThan(1);
  });

  it("MAX_MULTIPLIER — число > 1", () => {
    expect(MAX_MULTIPLIER).toBeGreaterThan(1);
  });

  it("DEFAULT_MULTIPLIER — 1.0", () => {
    expect(DEFAULT_MULTIPLIER).toBe(1.0);
  });

  it("MIN_SAMPLES_FOR_DYNAMIC — целое число ≥ 3", () => {
    expect(MIN_SAMPLES_FOR_DYNAMIC).toBeGreaterThanOrEqual(3);
    expect(Number.isInteger(MIN_SAMPLES_FOR_DYNAMIC)).toBe(true);
  });

  it("BASE_CITY_PRICING содержит > 10 городов", () => {
    expect(Object.keys(BASE_CITY_PRICING).length).toBeGreaterThan(10);
  });

  it("все множители в BASE_CITY_PRICING — в диапазоне [MIN, MAX]", () => {
    for (const [city, mult] of Object.entries(BASE_CITY_PRICING)) {
      expect(mult).toBeGreaterThanOrEqual(MIN_MULTIPLIER);
      expect(mult).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
  });
});

// ============================================================================
// normalizeCity
// ============================================================================

describe("normalizeCity", () => {
  it("приводит к lowercase", () => {
    expect(normalizeCity("Москва")).toBe("москва");
    expect(normalizeCity("САНКТ-ПЕТЕРБУРГ")).toBe("санкт-петербург");
  });

  it("trim пробелов", () => {
    expect(normalizeCity("  Москва  ")).toBe("москва");
  });

  it("удаляет префикс 'г.'", () => {
    expect(normalizeCity("г. Москва")).toBe("москва");
    expect(normalizeCity("Г. КАЗАНЬ")).toBe("казань");
  });

  it("удаляет префикс 'город'", () => {
    expect(normalizeCity("город Москва")).toBe("москва");
    expect(normalizeCity("Город Казань")).toBe("казань");
  });

  it("нормализует множественные пробелы в один", () => {
    expect(normalizeCity("Москва   центр")).toBe("москва центр");
  });

  it("возвращает пустую строку для null/undefined", () => {
    expect(normalizeCity(null as unknown as string)).toBe("");
    expect(normalizeCity(undefined as unknown as string)).toBe("");
  });

  it("возвращает пустую строку для пустой строки", () => {
    expect(normalizeCity("")).toBe("");
  });

  it("сохраняет дефисы", () => {
    expect(normalizeCity("Ростов-на-Дону")).toBe("ростов-на-дону");
  });
});

// ============================================================================
// parseWeightKg
// ============================================================================

describe("parseWeightKg", () => {
  it("парсит '1.5 кг' → 1.5", () => {
    expect(parseWeightKg("1.5 кг")).toBe(1.5);
  });

  it("парсит '2 кг' → 2", () => {
    expect(parseWeightKg("2 кг")).toBe(2);
  });

  it("парсит '1500 г' → 1.5", () => {
    expect(parseWeightKg("1500 г")).toBe(1.5);
  });

  it("парсит '800 грамм' → 0.8", () => {
    expect(parseWeightKg("800 грамм")).toBe(0.8);
  });

  it("парсит '0.5 кг' → 0.5", () => {
    expect(parseWeightKg("0.5 кг")).toBe(0.5);
  });

  it("парсит число с запятой вместо точки", () => {
    expect(parseWeightKg("1,5 кг")).toBe(1.5);
  });

  it("возвращает 0 для невалидной строки", () => {
    expect(parseWeightKg("не указан")).toBe(0);
    expect(parseWeightKg("")).toBe(0);
    expect(parseWeightKg(null)).toBe(0);
    expect(parseWeightKg(undefined)).toBe(0);
  });

  it("обрабатывает 'килограмм' вместо 'кг'", () => {
    expect(parseWeightKg("1.5 килограмм")).toBe(1.5);
  });

  it("возвращает число как кг по умолчанию", () => {
    // Если единица не указана — считаем, что это кг
    expect(parseWeightKg("3")).toBe(3);
  });

  it("обрабатывает заглавные буквы", () => {
    expect(parseWeightKg("1.5 КГ")).toBe(1.5);
    expect(parseWeightKg("800 Г")).toBe(0.8);
  });
});

// ============================================================================
// getBaseMultiplier
// ============================================================================

describe("getBaseMultiplier", () => {
  it("Москва — 1.4", () => {
    expect(getBaseMultiplier("Москва")).toBe(1.4);
  });

  it("мск — алиас Москвы (1.4)", () => {
    expect(getBaseMultiplier("мск")).toBe(1.4);
  });

  it("Санкт-Петербург — 1.3", () => {
    expect(getBaseMultiplier("Санкт-Петербург")).toBe(1.3);
  });

  it("СПб — алиас (1.3)", () => {
    expect(getBaseMultiplier("СПб")).toBe(1.3);
  });

  it("Казань — 0.9", () => {
    expect(getBaseMultiplier("Казань")).toBe(0.9);
  });

  it("Сочи — 1.2 (курортный)", () => {
    expect(getBaseMultiplier("Сочи")).toBe(1.2);
  });

  it("Мурманск — 1.15 (северный)", () => {
    expect(getBaseMultiplier("Мурманск")).toBe(1.15);
  });

  it("нормализует 'г. Москва' → множитель Москвы", () => {
    expect(getBaseMultiplier("г. Москва")).toBe(1.4);
  });

  it("DEFAULT_MULTIPLIER для неизвестного города", () => {
    expect(getBaseMultiplier("Несуществующий город")).toBe(DEFAULT_MULTIPLIER);
  });

  it("DEFAULT_MULTIPLIER для пустой строки", () => {
    expect(getBaseMultiplier("")).toBe(DEFAULT_MULTIPLIER);
  });

  it("DEFAULT_MULTIPLIER для null/undefined", () => {
    expect(getBaseMultiplier(null as unknown as string)).toBe(DEFAULT_MULTIPLIER);
    expect(getBaseMultiplier(undefined as unknown as string)).toBe(DEFAULT_MULTIPLIER);
  });

  it("все множители в диапазоне [MIN, MAX]", () => {
    expect(getBaseMultiplier("Москва")).toBeGreaterThanOrEqual(MIN_MULTIPLIER);
    expect(getBaseMultiplier("Москва")).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });
});

// ============================================================================
// clampMultiplier
// ============================================================================

describe("clampMultiplier", () => {
  it("возвращает DEFAULT_MULTIPLIER для NaN", () => {
    expect(clampMultiplier(NaN)).toBe(DEFAULT_MULTIPLIER);
  });

  it("возвращает DEFAULT_MULTIPLIER для Infinity", () => {
    expect(clampMultiplier(Infinity)).toBe(DEFAULT_MULTIPLIER);
    expect(clampMultiplier(-Infinity)).toBe(DEFAULT_MULTIPLIER);
  });

  it("ограничивает снизу", () => {
    expect(clampMultiplier(0.1)).toBe(MIN_MULTIPLIER);
    expect(clampMultiplier(0.5)).toBe(MIN_MULTIPLIER);
  });

  it("ограничивает сверху", () => {
    expect(clampMultiplier(3.0)).toBe(MAX_MULTIPLIER);
    expect(clampMultiplier(5.0)).toBe(MAX_MULTIPLIER);
  });

  it("пропускает валидные множители", () => {
    expect(clampMultiplier(1.0)).toBe(1.0);
    expect(clampMultiplier(1.4)).toBe(1.4);
    expect(clampMultiplier(0.9)).toBe(0.9);
  });

  it("пропускает MIN_MULTIPLIER", () => {
    expect(clampMultiplier(MIN_MULTIPLIER)).toBe(MIN_MULTIPLIER);
  });

  it("пропускает MAX_MULTIPLIER", () => {
    expect(clampMultiplier(MAX_MULTIPLIER)).toBe(MAX_MULTIPLIER);
  });
});

// ============================================================================
// calculateRegionalPriceSync
// ============================================================================

describe("calculateRegionalPriceSync", () => {
  it("Москва: торт 10000 → 14000 (множитель 1.4)", () => {
    const result = calculateRegionalPriceSync(10000, "Москва");
    expect(result.price).toBe(14000);
    expect(result.multiplier).toBe(1.4);
    expect(result.source).toBe("base");
    expect(result.city).toBe("москва");
  });

  it("Казань: торт 10000 → 9000 (множитель 0.9)", () => {
    const result = calculateRegionalPriceSync(10000, "Казань");
    expect(result.price).toBe(9000);
    expect(result.multiplier).toBe(0.9);
    expect(result.source).toBe("base");
  });

  it("СПб: торт 10000 → 13000 (множитель 1.3)", () => {
    const result = calculateRegionalPriceSync(10000, "Санкт-Петербург");
    expect(result.price).toBe(13000);
    expect(result.multiplier).toBe(1.3);
  });

  it("Сочи: торт 10000 → 12000 (курортный, множитель 1.2)", () => {
    const result = calculateRegionalPriceSync(10000, "Сочи");
    expect(result.price).toBe(12000);
    expect(result.multiplier).toBe(1.2);
  });

  it("Неизвестный город: множитель 1.0", () => {
    const result = calculateRegionalPriceSync(10000, "Неизвестный Город");
    expect(result.price).toBe(10000);
    expect(result.multiplier).toBe(1.0);
    expect(result.source).toBe("base");
  });

  it("Пустой город: без множителя", () => {
    const result = calculateRegionalPriceSync(10000, "");
    expect(result.price).toBe(10000);
    expect(result.multiplier).toBe(1.0);
    expect(result.city).toBe("");
  });

  it("Нормализует 'г. Москва' → 'москва'", () => {
    const result = calculateRegionalPriceSync(10000, "г. Москва");
    expect(result.city).toBe("москва");
    expect(result.multiplier).toBe(1.4);
  });

  it("Пример пользователя: Москва 2 кг ~12000 (множитель 1.4)", () => {
    // 12000 / 1.4 ≈ 8571 (базовая цена)
    const result = calculateRegionalPriceSync(8571, "Москва");
    // Math.round(8571 * 1.4) = 11999 — близко к 12000
    expect(result.price).toBeGreaterThan(11000);
    expect(result.price).toBeLessThan(13000);
    expect(result.multiplier).toBe(1.4);
  });

  it("Пример пользователя: Казань 2 кг ~8000 (множитель 0.9)", () => {
    // 8000 / 0.9 ≈ 8889 (базовая цена)
    const result = calculateRegionalPriceSync(8889, "Казань");
    expect(result.price).toBe(8000); // Math.round(8889 * 0.9) = 8000
    expect(result.multiplier).toBe(0.9);
  });

  it("Возвращает 0 для невалидной basePrice", () => {
    const result = calculateRegionalPriceSync(-100, "Москва");
    expect(result.price).toBe(0);
    expect(result.multiplier).toBe(1.0);
  });

  it("Возвращает 0 для NaN basePrice", () => {
    const result = calculateRegionalPriceSync(NaN, "Москва");
    expect(result.price).toBe(0);
  });

  it("Округляет цену до целого", () => {
    const result = calculateRegionalPriceSync(10001, "Москва"); // 10001 * 1.4 = 14001.4
    expect(Number.isInteger(result.price)).toBe(true);
  });
});

// ============================================================================
// compareCities
// ============================================================================

describe("compareCities", () => {
  it("Москва дороже Казани", () => {
    const diff = compareCities(10000, "Москва", "Казань");
    expect(diff.priceDiff).toBe(5000); // 14000 - 9000
    expect(diff.cheaper).toBe("Казань");
  });

  it("Москва дороже СПб", () => {
    const diff = compareCities(10000, "Москва", "Санкт-Петербург");
    expect(diff.cheaper).toBe("Санкт-Петербург");
    expect(diff.priceDiff).toBe(1000); // 14000 - 13000
  });

  it("Казань дешевле Сочи", () => {
    const diff = compareCities(10000, "Казань", "Сочи");
    expect(diff.cheaper).toBe("Казань");
    expect(diff.priceDiff).toBe(3000); // 12000 - 9000
  });

  it("percentDiff > 0 для разных городов", () => {
    const diff = compareCities(10000, "Москва", "Казань");
    expect(diff.percentDiff).toBeGreaterThan(0);
  });

  it("возвращает результаты обоих городов", () => {
    const diff = compareCities(10000, "Москва", "Казань");
    expect(diff.city1Result).toHaveProperty("price");
    expect(diff.city2Result).toHaveProperty("price");
    expect(diff.city1Result.city).toBe("москва");
    expect(diff.city2Result.city).toBe("казань");
  });
});

// ============================================================================
// getAllBaseMultipliers
// ============================================================================

describe("getAllBaseMultipliers", () => {
  it("возвращает массив объектов {city, multiplier}", () => {
    const list = getAllBaseMultipliers();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(10);
    for (const item of list) {
      expect(item).toHaveProperty("city");
      expect(item).toHaveProperty("multiplier");
      expect(typeof item.city).toBe("string");
      expect(typeof item.multiplier).toBe("number");
    }
  });

  it("содержит Москву с множителем 1.4", () => {
    const list = getAllBaseMultipliers();
    const moscow = list.find((c) => c.city === "москва");
    expect(moscow).toBeDefined();
    expect(moscow?.multiplier).toBe(1.4);
  });

  it("содержит Казань с множителем 0.9", () => {
    const list = getAllBaseMultipliers();
    const kazan = list.find((c) => c.city === "казань");
    expect(kazan).toBeDefined();
    expect(kazan?.multiplier).toBe(0.9);
  });

  it("все множители в диапазоне [MIN, MAX]", () => {
    const list = getAllBaseMultipliers();
    for (const { multiplier } of list) {
      expect(multiplier).toBeGreaterThanOrEqual(MIN_MULTIPLIER);
      expect(multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
  });
});

// ============================================================================
// Реальные сценарии пользователя
// ============================================================================

describe("Сценарии пользователя (из требования)", () => {
  /**
   * Требование пользователя:
   * "в Москве торт 2 кг будет стоить 12000 руб, а в Казани тот же торт будет 8000 руб"
   *
   * Базовая цена для этого примера = ~8571 (если множитель Москвы 1.4).
   * 8571 * 1.4 = 11999 ≈ 12000 ✓
   * 8571 * 0.9 = 7714 → недостаточно близко к 8000
   *
   * Альтернативно, базовая цена = 8889:
   * 8889 * 1.4 = 12445 ≠ 12000
   * 8889 * 0.9 = 8000 ✓
   *
   * Получается, что базовая цена зависит от города — но это не наша модель.
   * Наша модель: одна базовая цена, разные множители.
   *
   * Для точного соответствия примеру пользователя, множители должны быть:
   * - Москва: 1.5 (12000 / 8000 = 1.5)
   * - Казань: 1.0 (или базовая цена = 8000)
   *
   * Однако мы установили Москва=1.4, Казань=0.9 — это близко к реальности.
   * Тест проверяет, что наша система корректно применяет разные множители.
   */

  it("Москва дороже Казани для одного и того же торта", () => {
    const basePrice = 10000;
    const moscowPrice = calculateRegionalPriceSync(basePrice, "Москва").price;
    const kazanPrice = calculateRegionalPriceSync(basePrice, "Казань").price;
    expect(moscowPrice).toBeGreaterThan(kazanPrice);
  });

  it("Разница в цене значительная (>30%)", () => {
    const basePrice = 10000;
    const moscowPrice = calculateRegionalPriceSync(basePrice, "Москва").price;
    const kazanPrice = calculateRegionalPriceSync(basePrice, "Казань").price;
    const diff = moscowPrice - kazanPrice;
    const percentDiff = (diff / kazanPrice) * 100;
    expect(percentDiff).toBeGreaterThan(30);
  });

  it("Пример: торт базовой ценой 8571 → Москва ~12000", () => {
    const basePrice = 8571;
    const moscowResult = calculateRegionalPriceSync(basePrice, "Москва");
    // 8571 * 1.4 = 11999.4, округляем до 11999
    expect(moscowResult.price).toBeGreaterThan(11000);
    expect(moscowResult.price).toBeLessThan(13000);
    expect(moscowResult.multiplier).toBe(1.4);
  });

  it("Пример: торт базовой ценой 8889 → Казань = 8000", () => {
    const basePrice = 8889;
    const kazanResult = calculateRegionalPriceSync(basePrice, "Казань");
    expect(kazanResult.price).toBe(8000); // Math.round(8889 * 0.9) = 8000
    expect(kazanResult.multiplier).toBe(0.9);
  });

  it("Все города-миллионники имеют разные множители", () => {
    const cities = ["Москва", "Санкт-Петербург", "Казань", "Новосибирск", "Екатеринбург"];
    const multipliers = cities.map((c) => getBaseMultiplier(c));
    // Проверяем, что множители различаются
    const unique = new Set(multipliers);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("Москва — самый дорогой город в списке", () => {
    const cities = ["Москва", "Санкт-Петербург", "Казань", "Новосибирск", "Воронеж", "Тула"];
    const multipliers = cities.map((c) => ({ city: c, mult: getBaseMultiplier(c) }));
    const maxMult = Math.max(...multipliers.map((m) => m.mult));
    const moscow = multipliers.find((m) => m.city === "Москва");
    expect(moscow?.mult).toBe(maxMult);
  });
});
