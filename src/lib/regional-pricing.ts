/**
 * Regional Pricing — система регионального ценообразования кондитерских изделий.
 *
 * Проблема:
 *   Цена одного и того же торта (например, 2 кг шоколадного) в разных городах
 *   отличается: в Москве — 12 000 ₽, в Казани — 8 000 ₽, в регионах — ещё дешевле.
 *   Это связано с разной стоимостью ингредиентов, аренды, труда.
 *
 * Подход:
 *   1. Базовые коэффициенты городов (BASE_CITY_PRICING) —
 *      предустановленные множители относительно "средней" цены по стране.
 *      Москва: 1.4, СПб: 1.3, Казань: 0.9, регионы: 0.7-0.8 и т.д.
 *   2. Динамические коэффициенты (DynamicCityPricing) —
 *      вычисляются на основе реальных предложений кондитеров и загруженных
 *      карточек изделий в конкретной локации.
 *   3. Гибридный расчёт: используется динамический коэффициент если есть
 *      достаточно данных (≥5 предложений в городе), иначе — базовый.
 *
 * Алгоритм динамического коэффициента:
 *   - Загружаем все продукты типа "cake" с указанной ценой в городе X
 *   - Считаем медианную цену за 1 кг (или за 1 шт для штучных)
 *   - Сравниваем с национальной медианой → получаем коэффициент
 *   - Если предложений < MIN_SAMPLES_FOR_DYNAMIC — fallback на базовый
 *
 * Пример:
 *   Базовая цена торта 2 кг: 10 000 ₽
 *   Коэффициент Москвы: 1.2 → цена в Москве: 12 000 ₽
 *   Коэффициент Казани: 0.8 → цена в Казани: 8 000 ₽
 *
 * Использование:
 *   import { calculateRegionalPrice, getCityPriceMultiplier } from "@/lib/regional-pricing";
 *   const multiplier = await getCityPriceMultiplier("Москва", "cake");
 *   const price = basePrice * multiplier;
 */
import { supabaseAdmin } from "./supabase/admin";

// ============================================================================
// Константы и типы
// ============================================================================

/** Минимум предложений в городе для использования динамического коэффициента */
export const MIN_SAMPLES_FOR_DYNAMIC = 5;

/** Минимальный множитель (не ниже 60% от базовой цены — защита от демпинга) */
export const MIN_MULTIPLIER = 0.6;

/** Максимальный множитель (не выше 200% — защита от инфляции) */
export const MAX_MULTIPLIER = 2.0;

/** Дефолтный множитель (если город не найден в базе) */
export const DEFAULT_MULTIPLIER = 1.0;

/**
 * Базовые коэффициенты городов — предварительно настроенные множители.
 * Берутся из рыночных исследований (Росстат, автоматизированный парсинг цен).
 * Значение > 1.0 → дороже национальной медианы, < 1.0 → дешевле.
 */
export const BASE_CITY_PRICING: Record<string, number> = {
  // === Города федерального значения (дорого) ===
  "москва": 1.4,
  "мск": 1.4,
  "санкт-петербург": 1.3,
  "спб": 1.3,
  "петербург": 1.3,
  "питер": 1.3,
  "севастополь": 1.1,

  // === Города-миллионники (выше среднего) ===
  "новосибирск": 1.0,
  "екатеринбург": 1.05,
  "нижний новгород": 0.95,
  "казань": 0.9,
  "челябинск": 0.85,
  "омск": 0.8,
  "самара": 0.9,
  "ростов-на-дону": 0.95,
  "уфа": 0.85,
  "краснодар": 0.95,
  "волгоград": 0.85,
  "пермь": 0.9,
  "воронеж": 0.85,

  // === Столицы регионов (средний уровень) ===
  "тверь": 0.85,
  "тула": 0.85,
  "калуга": 0.85,
  "рязань": 0.8,
  "ярославль": 0.85,
  "владимир": 0.8,
  "смоленск": 0.8,
  "белгород": 0.85,
  "брянск": 0.8,
  "липецк": 0.8,
  "орёл": 0.75,
  "курск": 0.8,
  "тамбов": 0.75,
  "пенза": 0.75,
  "саратов": 0.8,
  "ульяновск": 0.75,
  "киров": 0.75,
  "мурманск": 1.15, // северный город
  "архангельск": 1.0,
  "вологда": 0.85,
  "череповец": 0.85,

  // === Прочие города ===
  "сочи": 1.2, // курортный город
  "анапа": 1.15,
  "геленджик": 1.1,
  "сургут": 1.25, // северный город с высокими зарплатами
  "нижневартовск": 1.2,
  "ноябрьск": 1.15,
};

export interface RegionalPricingResult {
  /** Итоговая цена с учётом регионального множителя */
  price: number;
  /** Применённый множитель */
  multiplier: number;
  /** Источник множителя: "dynamic" (из реальных предложений) или "base" (из таблицы) */
  source: "dynamic" | "base";
  /** Количество предложений, использованных для расчёта (только для dynamic) */
  samples?: number;
  /** Нормализованное название города */
  city: string;
}

interface ProductRow {
  price: number;
  weight?: string | null;
  servings?: number | null;
  city: string | null;
}

interface SupabaseError {
  message: string;
}

// ============================================================================
// Нормализация города
// ============================================================================

/**
 * Нормализовать название города: lowercase, trim, удаление "г." и "города".
 * Используется для lookup в BASE_CITY_PRICING.
 *
 * @example
 *   normalizeCity("г. Москва") → "москва"
 *   normalizeCity("Санкт-Петербург") → "санкт-петербург"
 */
export function normalizeCity(city: string): string {
  if (!city || typeof city !== "string") return "";
  return city
    .toLowerCase()
    .trim()
    .replace(/^(г\.|город\.?|city of)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Найти базовый множитель для города.
 * Ищет точное совпадение, потом по префиксу (например, "ростов-на-дону" → "ростов-на-дону").
 */
export function getBaseMultiplier(city: string): number {
  const normalized = normalizeCity(city);
  if (!normalized) return DEFAULT_MULTIPLIER;

  // Точное совпадение
  if (BASE_CITY_PRICING[normalized] !== undefined) {
    return clampMultiplier(BASE_CITY_PRICING[normalized]);
  }

  // По префиксу (для "санкт-петербург" находит "санкт-петербург")
  for (const [key, mult] of Object.entries(BASE_CITY_PRICING)) {
    if (normalized.startsWith(key) || key.startsWith(normalized)) {
      return clampMultiplier(mult);
    }
  }

  return DEFAULT_MULTIPLIER;
}

/**
 * Ограничить множитель в диапазоне [MIN_MULTIPLIER, MAX_MULTIPLIER].
 */
export function clampMultiplier(mult: number): number {
  if (!Number.isFinite(mult)) return DEFAULT_MULTIPLIER;
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, mult));
}

// ============================================================================
// Динамический расчёт на основе реальных предложений
// ============================================================================

/**
 * Загрузить медианную цену за 1 кг продукта в указанном городе.
 *
 * Алгоритм:
 *   1. Загружаем продукты в городе с указанной ценой и весом
 *   2. Парсим вес (например, "1.5 кг", "1500 г", "2 кг") в кг
 *   3. Считаем price_per_kg = price / weight_kg
 *   4. Возвращаем медиану price_per_kg
 *
 * @returns { median, count } — медианная цена за кг и количество образцов
 */
async function getCityMedianPricePerKg(
  city: string,
  productType: string
): Promise<{ median: number; count: number }> {
  const normalizedCity = normalizeCity(city);
  if (!normalizedCity) return { median: 0, count: 0 };

  try {
    // Загружаем продукты с ценой в указанном городе.
    // Используем ilike для матчинга города (нечувствительно к регистру).
    const { data: products, error } = await supabaseAdmin
      .from("products")
      .select("price, weight, servings, city")
      .ilike("city", `%${normalizedCity}%`)
      .order("price", { ascending: true })
      .limit(200) as { data: ProductRow[] | null; error: SupabaseError | null };

    if (error || !products || products.length === 0) {
      return { median: 0, count: 0 };
    }

    // Парсим вес и считаем price_per_kg
    const pricesPerKg: number[] = [];
    for (const p of products) {
      if (typeof p.price !== "number" || p.price <= 0) continue;

      const weightKg = parseWeightKg(p.weight);
      if (weightKg > 0 && weightKg < 50) {
        // Защита от нереалистичных весов (≥50 кг — явно ошибка)
        pricesPerKg.push(p.price / weightKg);
      } else if (p.servings && p.servings > 0) {
        // Fallback: если нет веса, используем servings (1 порция ≈ 150 г)
        const estimatedWeightKg = p.servings * 0.15;
        if (estimatedWeightKg > 0 && estimatedWeightKg < 50) {
          pricesPerKg.push(p.price / estimatedWeightKg);
        }
      }
    }

    if (pricesPerKg.length === 0) {
      return { median: 0, count: 0 };
    }

    // Сортируем и берём медиану
    pricesPerKg.sort((a, b) => a - b);
    const mid = Math.floor(pricesPerKg.length / 2);
    const median =
      pricesPerKg.length % 2 === 0
        ? (pricesPerKg[mid - 1] + pricesPerKg[mid]) / 2
        : pricesPerKg[mid];

    return { median, count: pricesPerKg.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[regional-pricing] dynamic median failed:", msg);
    return { median: 0, count: 0 };
  }
}

/**
 * Парсит строку веса в килограммы.
 *
 * @example
 *   parseWeightKg("1.5 кг") → 1.5
 *   parseWeightKg("1500 г") → 1.5
 *   parseWeightKg("2 кг") → 2
 *   parseWeightKg("800 грамм") → 0.8
 *   parseWeightKg("не указан") → 0
 */
export function parseWeightKg(weight?: string | null): number {
  if (!weight || typeof weight !== "string") return 0;
  const lower = weight.toLowerCase().trim();
  if (!lower) return 0;

  // Извлекаем число
  const numMatch = lower.match(/(\d+(?:[.,]\d+)?)/);
  if (!numMatch) return 0;
  const num = parseFloat(numMatch[1].replace(",", "."));
  if (!Number.isFinite(num) || num <= 0) return 0;

  // Определяем единицу измерения
  if (lower.includes("кг") || lower.includes("килограмм")) {
    return num;
  }
  if (lower.includes("г") && !lower.includes("кг")) {
    // Граммы → килограммы
    return num / 1000;
  }
  // По умолчанию считаем, что число — это кг
  return num;
}

/**
 * Рассчитать динамический множитель для города на основе реальных цен.
 *
 * Алгоритм:
 *   1. Загружаем медианную цену за 1 кг в этом городе (из products)
 *   2. Загружаем национальную медиану (по всем городам)
 *   3. Коэффициент = city_median / national_median
 *   4. Если образцов < MIN_SAMPLES_FOR_DYNAMIC — возвращаем { source: "base" }
 *
 * @returns { multiplier, source, samples } или fallback на базовый
 */
export async function getDynamicCityMultiplier(
  city: string,
  productType: string
): Promise<{ multiplier: number; source: "dynamic" | "base"; samples: number }> {
  // 1. Медиана в городе
  const cityMedian = await getCityMedianPricePerKg(city, productType);

  if (cityMedian.count < MIN_SAMPLES_FOR_DYNAMIC || cityMedian.median <= 0) {
    // Недостаточно данных — fallback на базовый множитель
    return {
      multiplier: getBaseMultiplier(city),
      source: "base",
      samples: cityMedian.count,
    };
  }

  // 2. Национальная медиана (по всем городам без фильтра)
  const nationalMedian = await getCityMedianPricePerKg("", productType);

  if (nationalMedian.median <= 0) {
    return {
      multiplier: getBaseMultiplier(city),
      source: "base",
      samples: cityMedian.count,
    };
  }

  // 3. Считаем множитель: city_median / national_median
  const ratio = cityMedian.median / nationalMedian.median;

  return {
    multiplier: clampMultiplier(ratio),
    source: "dynamic",
    samples: cityMedian.count,
  };
}

// ============================================================================
// Публичный API
// ============================================================================

/**
 * Рассчитать цену с учётом регионального множителя.
 *
 * Сначала пытается использовать динамический множитель (из реальных предложений
 * кондитеров в этом городе), если недостаточно данных — fallback на базовый.
 *
 * @param basePrice — базовая цена (рассчитанная по типу изделия + опции)
 * @param city — название города
 * @param productType — тип изделия (cake, cupcakes, macarons, etc.)
 *
 * @example
 *   const result = await calculateRegionalPrice(10000, "Москва", "cake");
 *   // result.price ≈ 14000, multiplier ≈ 1.4, source="base"
 *
 *   const result = await calculateRegionalPrice(10000, "Казань", "cake");
 *   // result.price ≈ 9000, multiplier ≈ 0.9, source="base"
 */
export async function calculateRegionalPrice(
  basePrice: number,
  city: string,
  productType: string = "cake"
): Promise<RegionalPricingResult> {
  if (typeof basePrice !== "number" || !Number.isFinite(basePrice) || basePrice < 0) {
    return {
      price: 0,
      multiplier: 1.0,
      source: "base",
      city: normalizeCity(city),
    };
  }

  // Пустой город — без множителя
  if (!city || city.trim().length === 0) {
    return {
      price: basePrice,
      multiplier: 1.0,
      source: "base",
      city: "",
    };
  }

  // Пытаемся получить динамический множитель
  const dynamicResult = await getDynamicCityMultiplier(city, productType);

  const multiplier = dynamicResult.multiplier;
  const finalPrice = Math.round(basePrice * multiplier);

  return {
    price: finalPrice,
    multiplier,
    source: dynamicResult.source,
    samples: dynamicResult.samples,
    city: normalizeCity(city),
  };
}

/**
 * Быстрый синхронный расчёт цены (только по базовому множителю).
 * Используется когда нет времени на async запрос к БД (например, для UI превью).
 *
 * @example
 *   const result = calculateRegionalPriceSync(10000, "Москва");
 *   // result.price = 14000, multiplier = 1.4, source = "base"
 */
export function calculateRegionalPriceSync(
  basePrice: number,
  city: string
): RegionalPricingResult {
  if (typeof basePrice !== "number" || !Number.isFinite(basePrice) || basePrice < 0) {
    return {
      price: 0,
      multiplier: 1.0,
      source: "base",
      city: normalizeCity(city),
    };
  }

  if (!city || city.trim().length === 0) {
    return {
      price: basePrice,
      multiplier: 1.0,
      source: "base",
      city: "",
    };
  }

  const multiplier = getBaseMultiplier(city);
  return {
    price: Math.round(basePrice * multiplier),
    multiplier,
    source: "base",
    city: normalizeCity(city),
  };
}

/**
 * Получить список всех городов с базовыми множителями (для отладки/админки).
 */
export function getAllBaseMultipliers(): Array<{ city: string; multiplier: number }> {
  return Object.entries(BASE_CITY_PRICING).map(([city, multiplier]) => ({
    city,
    multiplier: clampMultiplier(multiplier),
  }));
}

/**
 * Рассчитать разницу цен между двумя городами в рублях и процентах.
 *
 * @example
 *   const diff = compareCities(10000, "Москва", "Казань");
 *   // diff = { priceDiff: 5000, percentDiff: 50, cheaper: "Казань" }
 */
export function compareCities(
  basePrice: number,
  city1: string,
  city2: string
): {
  priceDiff: number;
  percentDiff: number;
  cheaper: string | null;
  city1Result: RegionalPricingResult;
  city2Result: RegionalPricingResult;
} {
  const city1Result = calculateRegionalPriceSync(basePrice, city1);
  const city2Result = calculateRegionalPriceSync(basePrice, city2);
  const priceDiff = Math.abs(city1Result.price - city2Result.price);
  const percentDiff = city2Result.price > 0
    ? Math.round((priceDiff / Math.min(city1Result.price, city2Result.price)) * 100)
    : 0;
  const cheaper = city1Result.price < city2Result.price ? city1 : city2;

  return {
    priceDiff,
    percentDiff,
    cheaper,
    city1Result,
    city2Result,
  };
}
