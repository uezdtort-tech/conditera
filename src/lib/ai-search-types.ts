/**
 * Умный AI-поиск десертов — общие типы и утилиты.
 *
 * Используется:
 *   • сервером — src/app/api/ai/search/route.ts (fallback-парсер NL-запроса);
 *   • клиентом — src/components/ai/ai-smart-search.tsx (применение фильтров
 *     к товарам из store и передача фильтров в каталог).
 *
 * Правила дизайна (по рекомендациям «AI-first без перегрузки интерфейса»):
 *   1. Не выдумывать свойства товара — если данных нет, товар не отбрасываем
 *      по «неизвестному» полю, но и не обещаем его.
 *   2. Не прятать обычный путь — фильтры применяются поверх стандартной
 *      каталоговой логики, обычный поиск остаётся доступным.
 *   3. Не обещать доступность — дата/наличие/цена подтверждаются продавцом,
 *      AI только разбирает запрос и сужает выдачу.
 */
import type { Product } from "@/lib/types";

/** Результат разбора естественного запроса на структурированные фильтры. */
export interface AiSearchFilters {
  /** Повод: "день рождения", "свадьба", "корпоратив"… (для UI-чипа) */
  occasion: string | null;
  /** Категория каталога (slug из CATEGORIES) */
  category: string | null;
  /** Сколько человек / порций */
  guests: number | null;
  /** Бюджет в рублях (потолок) */
  budget: number | null;
  /** Когда нужно: "к субботе", "завтра"… (информационный чип, НЕ фильтр) */
  dateHint: string | null;
  /** Вкусы, которые должны присутствовать (must-include) */
  tastes: string[];
  /** Чего быть не должно: "орехи", "сахар"… (exclude) */
  exclude: string[];
  /** Ключевые слова для поиска по названию/описанию/тегам (any-match) */
  keywords: string[];
  /** Короткий человеческий ответ ИИ (1–2 предложения) */
  reply: string;
  /** До 2 уточняющих вопросов, если ключевых параметров не хватает */
  clarifying: string[];
}

export function emptyAiFilters(reply = "", clarifying: string[] = []): AiSearchFilters {
  return {
    occasion: null,
    category: null,
    guests: null,
    budget: null,
    dateHint: null,
    tastes: [],
    exclude: [],
    keywords: [],
    reply,
    clarifying,
  };
}

/** Известные вкусы каталога (синхронизировано с фильтром каталога). */
export const AI_KNOWN_TASTES = [
  "шоколад",
  "ягоды",
  "карамель",
  "орехи",
  "ваниль",
  "лимон",
  "мёд",
  "сгущёнка",
  "маракуйя",
  "красный бархат",
] as const;

/** Словарь категорий для fallback-парсера и подсказки LLM. */
export const AI_CATEGORY_DICT: Array<{ slug: string; name: string; words: string[] }> = [
  { slug: "cakes", name: "Торты", words: ["торт", "торта", "торту", "торты", "язрусный ярус"] },
  { slug: "bento", name: "Бенто-торты", words: ["бенто"] },
  { slug: "cupcakes", name: "Капкейки", words: ["капкейк", "капкейки"] },
  { slug: "macarons", name: "Макаронс", words: ["макарон", "макаронс", "макаруны"] },
  { slug: "pastries", name: "Пирожные", words: ["пирожное", "пирожные", "эклер", "эклеры"] },
  { slug: "cookies", name: "Печенье", words: ["печенье", "имбирное"] },
  { slug: "chocolate", name: "Шоколад", words: ["шоколад ручной", "конфеты ручной"] },
  { slug: "desserts", name: "Десерты", words: ["десерт", "чизкейк", "тирамису", "пудинг"] },
  { slug: "pies", name: "Пироги", words: ["пирог", "пироги"] },
  { slug: "zephyr_bouquets", name: "Зефирные букеты", words: ["зефир"] },
  { slug: "healthy", name: "ПП изделия", words: ["пп", "без сахара", "полезный"] },
];

/**
 * Валидирует и нормализует фильтры, пришедшие от LLM.
 * Ничего не доверяем: числа — только конечные положительные, строки — обрезаем.
 */
export function normalizeAiFilters(raw: unknown, reply: string, clarifying: string[]): AiSearchFilters {
  const f = emptyAiFilters(reply, clarifying);
  if (!raw || typeof raw !== "object") return f;
  const o = raw as Record<string, unknown>;

  if (typeof o.occasion === "string" && o.occasion.trim()) f.occasion = o.occasion.trim().slice(0, 60);
  if (typeof o.category === "string" && o.category.trim()) f.category = o.category.trim().slice(0, 40);
  if (typeof o.dateHint === "string" && o.dateHint.trim()) f.dateHint = o.dateHint.trim().slice(0, 60);

  if (typeof o.guests === "number" && Number.isFinite(o.guests) && o.guests > 0 && o.guests <= 1000) {
    f.guests = Math.round(o.guests);
  }
  if (typeof o.budget === "number" && Number.isFinite(o.budget) && o.budget > 0 && o.budget <= 10_000_000) {
    f.budget = Math.round(o.budget);
  }

  const strArr = (v: unknown, max: number, len: number): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().toLowerCase().slice(0, len)).slice(0, max)
      : [];

  f.tastes = strArr(o.tastes, 6, 40);
  f.exclude = strArr(o.exclude, 8, 40);
  f.keywords = strArr(o.keywords, 6, 40);
  return f;
}

function textOf(p: Pick<Product, "title" | "description" | "tags">): string {
  return [p.title, p.description, (p.tags || []).join(" ")].join(" ").toLowerCase();
}

function textOfComposition(p: Product): string {
  const comp = p.composition;
  if (!comp) return "";
  return [...(comp.ingredients || []), ...(comp.allergens || [])].join(" ").toLowerCase();
}

/**
 * Применяет AI-фильтры к списку товаров.
 *
 * Мягкая логика: если поля у товара нет (например, servings неизвестен) —
 * товар НЕ отбрасываем (не выдумываем свойства, не теряем то, чего не знаем).
 * Исключения (аллергены) ищем и в составе — там их отсутствие уже факт.
 */
export function filterProductsByAiFilters(products: Product[], f: AiSearchFilters): Product[] {
  return products.filter((p) => {
    if (f.budget !== null && p.price > f.budget) return false;

    if (f.guests !== null && typeof p.servings === "number" && p.servings > 0 && p.servings < f.guests) {
      return false;
    }

    if (f.category && p.category !== f.category) return false;

    const hay = textOf(p);
    const compHay = textOfComposition(p);

    for (const t of f.tastes) {
      if (!hay.includes(t)) return false;
    }

    for (const ex of f.exclude) {
      // Исключаем, если слово встречается в описании/тегах/названии или в составе.
      if (hay.includes(ex) || (compHay && compHay.includes(ex))) return false;
    }

    if (f.keywords.length > 0) {
      const anyKeyword = f.keywords.some((kw) => hay.includes(kw));
      if (!anyKeyword) return false;
    }

    return true;
  });
}

/** Короткие человекочитаемые чипы применённых фильтров (для UI). */
export function describeAiFilters(f: AiSearchFilters): string[] {
  const chips: string[] = [];
  if (f.occasion) chips.push(f.occasion);
  if (f.guests) chips.push(`на ${f.guests} чел.`);
  if (f.budget) chips.push(`до ${f.budget.toLocaleString("ru-RU")} ₽`);
  if (f.tastes.length) chips.push(`вкус: ${f.tastes.join(", ")}`);
  if (f.exclude.length) chips.push(`без: ${f.exclude.join(", ")}`);
  if (f.dateHint) chips.push(f.dateHint);
  return chips;
}
