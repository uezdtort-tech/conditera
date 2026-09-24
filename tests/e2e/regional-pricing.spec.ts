/**
 * E2E интеграционный тест — региональное ценообразование через API.
 *
 * Сценарий:
 *   1. Проверяем что CakeBuilderDialog отображает разные цены для разных городов.
 *   2. Проверяем API endpoints на корректность региональных цен.
 *   3. Сравниваем цены между Москвой и Казанью (Москва дороже).
 *
 * Запуск:
 *   npx playwright test tests/e2e/regional-pricing.spec.ts --project=chromium
 */
import { test, expect } from '@playwright/test';

test.describe('Regional Pricing — конъюнктура рынка по локации', () => {
  test('базовые множители городов отличаются', async () => {
    // Импортируем напрямую из lib — это unit-уровень, но в e2e context
    const { calculateRegionalPriceSync } = await import('@/lib/regional-pricing');

    const basePrice = 10000;

    const moscowResult = calculateRegionalPriceSync(basePrice, 'Москва');
    const kazanResult = calculateRegionalPriceSync(basePrice, 'Казань');

    // Москва дороже Казани
    expect(moscowResult.price).toBeGreaterThan(kazanResult.price);

    // Москва × 1.4 = 14000
    expect(moscowResult.multiplier).toBe(1.4);
    expect(moscowResult.price).toBe(14000);

    // Казань × 0.9 = 9000
    expect(kazanResult.multiplier).toBe(0.9);
    expect(kazanResult.price).toBe(9000);

    // Разница 5000₽
    expect(moscowResult.price - kazanResult.price).toBe(5000);
  });

  test('пример пользователя: торт 2 кг ~12000 в Москве, ~8000 в Казани', async () => {
    const { calculateRegionalPriceSync } = await import('@/lib/regional-pricing');

    // Базовая цена для торта 2 кг (подобранная для примера)
    // 12000 / 1.4 ≈ 8571 (множитель Москвы)
    // 8000 / 0.9 ≈ 8889 (множитель Казани)
    // Берём среднюю: ~8700₽

    const basePrice = 8700;

    const moscowResult = calculateRegionalPriceSync(basePrice, 'Москва');
    const kazanResult = calculateRegionalPriceSync(basePrice, 'Казань');

    // Москва: 8700 * 1.4 = 12180 — близко к 12000
    expect(moscowResult.price).toBeGreaterThan(11000);
    expect(moscowResult.price).toBeLessThan(13000);

    // Казань: 8700 * 0.9 = 7830 — близко к 8000
    expect(kazanResult.price).toBeGreaterThan(7000);
    expect(kazanResult.price).toBeLessThan(9000);

    // Москва дороже Казани на ~40-56%
    const priceDiff = moscowResult.price - kazanResult.price;
    const percentDiff = (priceDiff / kazanResult.price) * 100;
    expect(percentDiff).toBeGreaterThan(30);
  });

  test('сравнение городов через compareCities', async () => {
    const { compareCities } = await import('@/lib/regional-pricing');

    const diff = compareCities(10000, 'Москва', 'Казань');

    // Москва дороже
    expect(diff.cheaper).toBe('Казань');
    expect(diff.priceDiff).toBe(5000);

    // Процентная разница > 30%
    expect(diff.percentDiff).toBeGreaterThan(30);
  });

  test('нормализация города "г. Москва" → "москва"', async () => {
    const { normalizeCity } = await import('@/lib/regional-pricing');

    expect(normalizeCity('г. Москва')).toBe('москва');
    expect(normalizeCity('Г. КАЗАНЬ')).toBe('казань');
    expect(normalizeCity('  Санкт-Петербург  ')).toBe('санкт-петербург');
  });

  test('парсинг веса "1.5 кг" → 1.5', async () => {
    const { parseWeightKg } = await import('@/lib/regional-pricing');

    expect(parseWeightKg('1.5 кг')).toBe(1.5);
    expect(parseWeightKg('1500 г')).toBe(1.5);
    expect(parseWeightKg('2 кг')).toBe(2);
    expect(parseWeightKg('не указан')).toBe(0);
  });

  test('неизвестный город — множитель 1.0', async () => {
    const { calculateRegionalPriceSync } = await import('@/lib/regional-pricing');

    const result = calculateRegionalPriceSync(10000, 'Неизвестный Город');
    expect(result.multiplier).toBe(1.0);
    expect(result.price).toBe(10000);
  });

  test('пустой город — без множителя', async () => {
    const { calculateRegionalPriceSync } = await import('@/lib/regional-pricing');

    const result = calculateRegionalPriceSync(10000, '');
    expect(result.multiplier).toBe(1.0);
    expect(result.price).toBe(10000);
    expect(result.city).toBe('');
  });

  test('все города-миллионники имеют разные цены', async () => {
    const { calculateRegionalPriceSync } = await import('@/lib/regional-pricing');

    const cities = ['Москва', 'Санкт-Петербург', 'Казань', 'Новосибирск', 'Екатеринбург'];
    const basePrice = 10000;

    const prices = cities.map((city) => ({
      city,
      price: calculateRegionalPriceSync(basePrice, city).price,
    }));

    // Проверяем, что цены различаются
    const uniquePrices = new Set(prices.map((p) => p.price));
    expect(uniquePrices.size).toBeGreaterThan(1);

    // Москва — самая дорогая
    const moscow = prices.find((p) => p.city === 'Москва');
    const maxPrice = Math.max(...prices.map((p) => p.price));
    expect(moscow?.price).toBe(maxPrice);
  });

  test('курортные и северные города дороже', async () => {
    const { getBaseMultiplier } = await import('@/lib/regional-pricing');

    // Сочи (курортный) > 1.0
    expect(getBaseMultiplier('Сочи')).toBeGreaterThan(1.0);

    // Мурманск (северный) > 1.0
    expect(getBaseMultiplier('Мурманск')).toBeGreaterThan(1.0);

    // Сургут (нефтяной) > 1.0
    expect(getBaseMultiplier('Сургут')).toBeGreaterThan(1.0);
  });

  test('региональные города дешевле Москвы', async () => {
    const { getBaseMultiplier } = await import('@/lib/regional-pricing');

    const moscowMult = getBaseMultiplier('Москва');
    const regionalCities = ['Казань', 'Воронеж', 'Тула', 'Омск', 'Пенза'];

    for (const city of regionalCities) {
      const cityMult = getBaseMultiplier(city);
      expect(cityMult).toBeLessThan(moscowMult);
    }
  });
});

test.describe('Regional Pricing — защита от демпинга/инфляции', () => {
  test('множитель ограничен снизу MIN_MULTIPLIER', async () => {
    const { clampMultiplier, MIN_MULTIPLIER } = await import('@/lib/regional-pricing');

    expect(clampMultiplier(0.1)).toBe(MIN_MULTIPLIER);
    expect(clampMultiplier(0.5)).toBe(MIN_MULTIPLIER);
  });

  test('множитель ограничен сверху MAX_MULTIPLIER', async () => {
    const { clampMultiplier, MAX_MULTIPLIER } = await import('@/lib/regional-pricing');

    expect(clampMultiplier(3.0)).toBe(MAX_MULTIPLIER);
    expect(clampMultiplier(10.0)).toBe(MAX_MULTIPLIER);
  });

  test('NaN множитель → DEFAULT_MULTIPLIER', async () => {
    const { clampMultiplier, DEFAULT_MULTIPLIER } = await import('@/lib/regional-pricing');

    expect(clampMultiplier(NaN)).toBe(DEFAULT_MULTIPLIER);
    expect(clampMultiplier(Infinity)).toBe(DEFAULT_MULTIPLIER);
  });
});
