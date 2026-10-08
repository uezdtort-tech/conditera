/**
 * Единый детерминированный поисковый движок каталога (P2.1).
 *
 * Используется:
 *   • сервером — GET /api/products (поиск + фильтры поверх БД);
 *   • клиентом — каталог (мгновенная фильтрация по live-товарам);
 *   • в перспективе P2.2 («Помочь выбрать») и P2.5 (AI natural-language search)
 *     — как единственный механизм подбора (второй движок не создаётся).
 *
 * Правила (из ТЗ P2):
 *   • данные товара — единственный источник истины (title, описания, начинка,
 *     теги, dietary_features, composition, цена, порции); движок ничего не
 *     придумывает и не фильтрует по «неизвестным» полям;
 *   • морфология — через префиксные стемы («красный» находит «красных»);
 *   • «на 10 человек», «до 4000», «без орехов» разбираются детерминированным
 *     парсером (это НЕ AI; AI-парсинг запроса — отдельный слой P2.5);
 *   • товары без данных (servings=null, пустые dietary_features) не
 *     отбрасываются по этим осям — не выдумываем свойства товара.
 */

/* ------------------------------------------------------------------ *
 * Нормализованный поисковый документ                                  *
 * ------------------------------------------------------------------ */

/** Нормализованный документ товара для поиска (из БД или store). */
export interface SearchDoc {
  id: string;
  title: string;
  /** Все текстовые поля карточки: short/long description, описание, начинка */
  texts: string[];
  tags: string[];
  /** dietary_features из БД: «содержит орехи», «без сахара», «веган»… */
  dietary: string[];
  /** allergens/ingredients из composition (могут быть пустыми) */
  compositionTexts: string[];
  price: number;
  servings: number | null;
  /** Вес изделия в граммах (weight_grams) — фильтр «Размер» (P2 §4) */
  weightGrams: number | null;
  isAvailable: boolean;
  rating: number;
  reviewsCount: number;
}

/** Атрибуты произвольного товара, достаточные для сборки SearchDoc. */
export interface SearchableProductLike {
  id: string;
  title: string;
  description?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  fillingDescription?: string | null;
  tags?: string[] | null;
  dietaryFeatures?: string[] | null;
  composition?: { ingredients?: string[]; allergens?: string[] } | null;
  price: number;
  servings?: number | null;
  weightGrams?: number | null;
  isAvailable?: boolean;
  rating?: number | null;
  reviewsCount?: number | null;
}

export function toSearchDoc(p: SearchableProductLike): SearchDoc {
  return {
    id: p.id,
    title: p.title ?? "",
    texts: [
      p.shortDescription ?? "",
      p.longDescription ?? "",
      p.description ?? "",
      p.fillingDescription ?? "",
    ].filter(Boolean),
    tags: p.tags ?? [],
    dietary: p.dietaryFeatures ?? [],
    compositionTexts: [
      ...(p.composition?.ingredients ?? []),
      ...(p.composition?.allergens ?? []),
    ],
    price: typeof p.price === "number" && Number.isFinite(p.price) ? p.price : 0,
    servings: typeof p.servings === "number" && p.servings > 0 ? p.servings : null,
    weightGrams:
      typeof p.weightGrams === "number" && Number.isFinite(p.weightGrams) && p.weightGrams > 0
        ? p.weightGrams
        : null,
    isAvailable: p.isAvailable !== false,
    rating: typeof p.rating === "number" ? p.rating : 0,
    reviewsCount: typeof p.reviewsCount === "number" ? p.reviewsCount : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Стемы: морфология через префикс                                     *
 * ------------------------------------------------------------------ */

/**
 * «Стем» слова для substring-поиска: отрезаем до max(4, len-2), но не
 * длиннее 5 символов. Кап на 5 даёт двустороннее совпадение с короткой
 * формой из данных: «шоколадный»→«шокол» находит и «шоколад» (тег), и
 * «шоколадные» (описание); «красный»→«красн» находит «красных»;
 * «торт»→«торт».
 */
export function wordStem(raw: string): string {
  const w = raw.toLowerCase().replace(/ё/g, "е").trim();
  if (!w) return "";
  const cut = Math.min(5, Math.max(4, w.length - 2));
  return w.slice(0, cut);
}

/* ------------------------------------------------------------------ *
 * Аллергены / ограничения                                             *
 * ------------------------------------------------------------------ */

export type AllergenKey = "nuts" | "gluten" | "sugar" | "lactose" | "egg";

/**
 * Группы аллергенов: список стемов, по которым встречается аллерген в
 * реальных данных каталога (dietary_features, composition, описание).
 * «молочные продукты» → «молочн», «фисташка» → орехи и т.д.
 */
export const ALLERGEN_GROUPS: Record<AllergenKey, { label: string; stems: string[] }> = {
  nuts: {
    label: "Без орехов",
    stems: ["орех", "миндал", "фисташ", "кешью", "фундук", "прали", "нуга", "нуг"],
  },
  gluten: {
    label: "Без глютена",
    stems: ["глютен", "пшенич"],
  },
  sugar: {
    label: "Без сахара",
    stems: ["сахар"],
  },
  lactose: {
    label: "Без молочных продуктов",
    stems: ["молок", "молочн", "лакт", "сливк", "сливочн", "сыр", "творо"],
  },
  egg: {
    label: "Без яиц",
    stems: ["яйц", "яичн"],
  },
};

/* ------------------------------------------------------------------ *
 * Поводы (по реальным словам каталога — теги/описания)                *
 * ------------------------------------------------------------------ */

export type OccasionKey = "birthday" | "wedding" | "kids" | "gift" | "holiday";

export const OCCASIONS: Record<OccasionKey, { label: string; stems: string[] }> = {
  birthday: {
    label: "День рождения",
    stems: ["день рождения", "дня рождения", "рождения", "birthday", "детск"],
  },
  wedding: {
    label: "Свадьба",
    stems: ["свадеб", "свадьб", "wedding"],
  },
  kids: {
    label: "Детский праздник",
    stems: ["детск", "ребенк", "для детей"],
  },
  gift: {
    label: "Подарок",
    stems: ["подарок", "подарит", "gift"],
  },
  holiday: {
    label: "Праздник / фуршет",
    stems: ["праздник", "фуршет", "корпорат"],
  },
};

/* ------------------------------------------------------------------ *
 * Разбор запроса (детерминированный, без AI)                          *
 * ------------------------------------------------------------------ */

export interface QueryIntent {
  /** Нормализованные стемы-ключевые слова (OR-поиск со скорингом) */
  tokens: string[];
  priceMin: number | null;
  priceMax: number | null;
  servingsMin: number | null;
  occasion: OccasionKey | null;
  excludeAllergens: AllergenKey[];
  /** Произвольные «без X», не попавшие в группы аллергенов (стемы) */
  genericExcludes: string[];
  /** Вкусы must-have (из фильтра каталога): стемы */
  tastes: string[];
}

const STOPWORDS = new Set([
  "на", "для", "с", "и", "в", "к", "по", "из", "от", "при", "или", "а", "же",
  "бы", "ли", "мне", "нужен", "нужна", "нужно", "надо", "хочу", "хотел", "ищу",
  "где", "как", "что", "это", "мой", "моя", "еще", "уже", "very", "the", "a",
  "есть", "был", "быть", "можно", "пожалуйста", "спасибо", "рублей", "рубля",
  "рубль", "тысяч", "человек", "человека", "персон", "персоны", "гостей",
  "гостя", "порций", "порции",
]);

const ALLERGEN_TRIGGER_STEMS: Array<{ stems: string[]; key: AllergenKey }> = Object.entries(
  ALLERGEN_GROUPS
).map(([key, group]) => ({ stems: group.stems, key: key as AllergenKey }));

const OCCASION_PHRASES: Array<{ re: RegExp; key: OccasionKey }> = [
  { re: /день\s+рожд|дня\s+рожд|дню\s+рожд|днюх|birthday/i, key: "birthday" },
  { re: /свадьб|свадеб|wedding/i, key: "wedding" },
  { re: /детск|\bдетям\b|ребенк/i, key: "kids" },
  { re: /подарок|подарить|gift/i, key: "gift" },
  { re: /фуршет|корпорат|праздник/i, key: "holiday" },
];

function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/\s+/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Разбор естественной поисковой строки в структурированный интент.
 * Примеры:
 *   «торт на 10 человек до 4000 без орехов»
 *     → { tokens:["торт"], servingsMin:10, priceMax:4000, excludeAllergens:["nuts"] }
 *   «шоколадный торт» → { tokens:["шоколад","торт"] }
 */
export function parseQueryIntent(rawQuery: string): QueryIntent {
  const q = (rawQuery || "").toLowerCase().replace(/ё/g, "е").trim();
  const intent: QueryIntent = {
    tokens: [],
    priceMin: null,
    priceMax: null,
    servingsMin: null,
    occasion: null,
    excludeAllergens: [],
    genericExcludes: [],
    tastes: [],
  };
  if (!q) return intent;

  let rest = q;

  // Повод по устойчивым фразам запроса
  for (const phrase of OCCASION_PHRASES) {
    if (phrase.re.test(rest)) {
      intent.occasion = phrase.key;
      break;
    }
  }

  // Бюджет: «до 4000», «до 4 000 ₽», «от 2000 ₽», остаток «4000 рублей»
  const maxMatch = rest.match(/(?:до|бюджет|максимум)\s*(\d[\d\s]{2,8})/);
  if (maxMatch) {
    const n = parseNumber(maxMatch[1]);
    // бюджет — от 100 ₽ до 10 млн
    if (n && n >= 100 && n <= 10_000_000) {
      intent.priceMax = n;
      rest = rest.replace(maxMatch[0], " ");
    }
  }
  if (intent.priceMax === null) {
    // «от N ₽» — нижняя граница (важно разобрать ДО валютного максимума,
    // иначе «от 2000 ₽» жадно съедается как priceMax)
    const minMatch = rest.match(/от\s*(\d[\d\s]{2,8})\s*(?:₽|руб)/);
    if (minMatch) {
      const n = parseNumber(minMatch[1]);
      if (n && n >= 100 && n <= 10_000_000) {
        intent.priceMin = n;
        rest = rest.replace(minMatch[0], " ");
      }
    }
  }
  if (intent.priceMax === null) {
    const curMatch = rest.match(/(\d[\d\s]{2,8})\s*(?:₽|руб)/);
    if (curMatch) {
      const n = parseNumber(curMatch[1]);
      if (n && n >= 100 && n <= 10_000_000) {
        intent.priceMax = n;
        rest = rest.replace(curMatch[0], " ");
      }
    }
  }

  // Количество человек: «на 10 человек», «для 20 гостей», «15 порций»
  const peopleMatch = rest.match(
    /(?:на|для)?\s*(\d{1,3})\s*(?:челов|персо|гост|порци)/
  );
  if (peopleMatch) {
    const n = Number(peopleMatch[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 500) {
      intent.servingsMin = n;
      rest = rest.replace(peopleMatch[0], " ");
    }
  }

  // Ограничения: «без орехов», «без сахара», «без глютена», «безмолочный»…
  // matchAll — без состояния lastIndex (exec после replace терял второй «без …»)
  const withoutMatches = Array.from(rest.matchAll(/без\s+([а-яa-z]+)/gi));
  if (withoutMatches.length > 0) {
    for (const m of withoutMatches) {
      const stem = wordStem(m[1]);
      const group = ALLERGEN_TRIGGER_STEMS.find((g) =>
        g.stems.some((s) => stem.startsWith(s) || s.startsWith(stem))
      );
      if (group) {
        if (!intent.excludeAllergens.includes(group.key)) {
          intent.excludeAllergens.push(group.key);
        }
      } else if (stem.length >= 4) {
        intent.genericExcludes.push(stem);
      }
    }
    rest = rest.replace(/без\s+[а-яa-z]+/gi, " ");
  }

  // Ключевые слова: остатки запроса без стоп-слов и чисел-количеств
  const words = rest
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const w of words) {
    if (/^\d+$/.test(w)) continue; // «10» из «торт на 10 человек» уже разобрано
    if (STOPWORDS.has(w)) continue;
    if (w.length < 3) continue;
    const stem = wordStem(w);
    if (stem && !intent.tokens.includes(stem)) intent.tokens.push(stem);
  }

  return intent;
}

/* ------------------------------------------------------------------ *
 * Скоринг и фильтрация                                                *
 * ------------------------------------------------------------------ */

function hayOf(doc: SearchDoc): { full: string; title: string } {
  return {
    full: [doc.title, ...doc.texts, ...doc.tags, ...doc.dietary, ...doc.compositionTexts]
      .join(" ")
      .toLowerCase(),
    title: doc.title.toLowerCase(),
  };
}

/** Соответствует ли товар поводу (по реальным словам каталога). */
export function matchesOccasion(doc: SearchDoc, occasion: OccasionKey): boolean {
  const { full, title } = hayOf(doc);
  return OCCASIONS[occasion].stems.some((s) => full.includes(s) || title.includes(s));
}

/**
 * Ограничение по аллергену: товар исключается, только если данные о нём
 * реально присутствуют (dietary_features / composition / тексты).
 * Позитивная пометка «без X» приоритетнее «содержит X».
 */
export function passesAllergen(doc: SearchDoc, key: AllergenKey): boolean {
  const group = ALLERGEN_GROUPS[key];
  const full = hayOf(doc).full;
  const flagged = group.stems.some((s) => full.includes(s));
  if (!flagged) return true; // данных нет — не выдумываем
  // «без глютена», «без сахара» — позитивная пометка, товар подходит
  return group.stems.some((s) => full.includes(`без ${s}`));
}

/**
 * Скоринг документа против интента. Возвращает null — документ не
 * соответствует фильтрам; иначе число (чем больше, тем релевантнее).
 *
 * Ключевые слова — OR-семантика со скорингом: матч по title весит 2,
 * по тегам 1.5, по остальным полям 1. Фильтры (цена/порции/повод/
 * ограничения/вкусы) — AND-семантика.
 */
export function scoreSearchDoc(doc: SearchDoc, intent: QueryIntent): number | null {
  // --- Фильтры (AND) ---
  if (intent.priceMin !== null && doc.price < intent.priceMin) return null;
  if (intent.priceMax !== null && doc.price > intent.priceMax) return null;
  if (
    intent.servingsMin !== null &&
    doc.servings !== null &&
    doc.servings < intent.servingsMin
  ) {
    return null; // известное число порций меньше запрошенного — честный фильтр
  }
  if (intent.occasion && !matchesOccasion(doc, intent.occasion)) return null;
  for (const key of intent.excludeAllergens) {
    if (!passesAllergen(doc, key)) return null;
  }
  if (intent.genericExcludes.length > 0) {
    const full = hayOf(doc).full;
    if (intent.genericExcludes.some((stem) => full.includes(stem))) return null;
  }
  if (intent.tastes.length > 0) {
    const full = hayOf(doc).full;
    if (!intent.tastes.every((stem) => full.includes(stem))) return null;
  }

  // --- Ключевые слова (OR + скоринг) ---
  if (intent.tokens.length === 0) return 0;
  const { full, title } = hayOf(doc);
  const tags = doc.tags.join(" ").toLowerCase();
  let score = 0;
  for (const stem of intent.tokens) {
    if (title.includes(stem)) score += 2;
    else if (tags.includes(stem)) score += 1.5;
    else if (full.includes(stem)) score += 1;
    // токен не найден — просто не добавляет вес (OR-семантика)
  }
  return score > 0 ? score : null;
}

export interface RankOptions {
  limit?: number;
  offset?: number;
  /** Сортировка при нулевом поисковом скоринге (чистые фильтры) */
  sort?: "popular" | "price-asc" | "price-desc" | "rating";
}

/**
 * Фильтрация + ранжирование списка документов.
 * При поисковых токенах — сначала по релевантности, затем по sort;
 * без токенов — по sort (popular = reviews_count desc, затем rating).
 */
export function filterAndRank(
  docs: SearchDoc[],
  intent: QueryIntent,
  options: RankOptions = {}
): { items: SearchDoc[]; total: number } {
  const { limit, offset = 0, sort = "popular" } = options;
  const scored: Array<{ doc: SearchDoc; score: number }> = [];
  for (const doc of docs) {
    const score = scoreSearchDoc(doc, intent);
    if (score !== null) scored.push({ doc, score });
  }
  const hasKeywords = intent.tokens.length > 0;
  scored.sort((a, b) => {
    if (hasKeywords && b.score !== a.score) return b.score - a.score;
    switch (sort) {
      case "price-asc":
        return a.doc.price - b.doc.price;
      case "price-desc":
        return b.doc.price - a.doc.price;
      case "rating":
        return b.doc.rating - a.doc.rating;
      case "popular":
      default:
        return (
          b.doc.reviewsCount - a.doc.reviewsCount || b.doc.rating - a.doc.rating
        );
    }
  });
  const total = scored.length;
  const items =
    typeof limit === "number" ? scored.slice(offset, offset + limit).map((s) => s.doc) : scored.map((s) => s.doc);
  return { items, total };
}

/* ------------------------------------------------------------------ *
 * P2.2 «Помочь выбрать»: ответы вопросника → интент движка            *
 * ------------------------------------------------------------------ */

export type WhenNeeded = "today" | "tomorrow" | "week" | null;

/** Ответы вопросника «Помочь выбрать» (короткая анкета, ТЗ P2 §5). */
export interface HelpChooseAnswers {
  occasion: OccasionKey | null;
  servingsMin: number | null;
  priceMax: number | null;
  /** Вкусы, которые хотелось бы (сырые слова: «шоколад», «ягоды»…) */
  tastes: string[];
  excludeAllergens: AllergenKey[];
  /** Когда нужен заказ — влияет на сортировку по доступности (ТЗ §14) */
  when: WhenNeeded;
}

export function emptyHelpAnswers(): HelpChooseAnswers {
  return {
    occasion: null,
    servingsMin: null,
    priceMax: null,
    tastes: [],
    excludeAllergens: [],
    when: null,
  };
}

/** Есть ли в ответах хоть что-то, влияющее на подбор. */
export function hasHelpSignals(a: HelpChooseAnswers): boolean {
  return Boolean(
    a.occasion ||
      a.servingsMin ||
      a.priceMax ||
      a.tastes.length > 0 ||
      a.excludeAllergens.length > 0
  );
}

/** Ответы вопросника → интент единого движка (AI не участвует). */
export function answersToIntent(a: HelpChooseAnswers): QueryIntent {
  const intent: QueryIntent = {
    tokens: [],
    priceMin: null,
    priceMax: a.priceMax,
    servingsMin: a.servingsMin,
    occasion: a.occasion,
    excludeAllergens: [...a.excludeAllergens],
    genericExcludes: [],
    tastes: a.tastes.map(wordStem).filter(Boolean),
  };
  return intent;
}

/**
 * Доступность к дате (ТЗ §14): товар с известным production_time_hours,
 * который не успевает к нужной дате, не скрывается и не даёт 422 —
 * показывается с пометкой «Ближайшая дата — …» и ранжируется ниже.
 * production_time_hours неизвестен → доступность не обещаем и не запрещаем.
 */
export function readyByDate(
  productionTimeHours: number | null,
  when: WhenNeeded,
  now: Date = new Date()
): { available: boolean; readyAt: Date | null } {
  if (!when) return { available: true, readyAt: null };
  if (typeof productionTimeHours !== "number" || !Number.isFinite(productionTimeHours) || productionTimeHours <= 0) {
    return { available: true, readyAt: null }; // данных нет — не выдумываем
  }
  const deadline = new Date(now);
  if (when === "today") {
    deadline.setHours(23, 59, 59, 999);
  } else if (when === "tomorrow") {
    deadline.setDate(deadline.getDate() + 1);
    deadline.setHours(23, 59, 59, 999);
  } else {
    deadline.setDate(deadline.getDate() + 7);
    deadline.setHours(23, 59, 59, 999);
  }
  const readyAt = new Date(now.getTime() + productionTimeHours * 3600_000);
  return { available: readyAt <= deadline, readyAt };
}

/** «14 октября» — человекочитаемая дата ближайшей готовности. */
export function formatReadyDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatPriceRub(v: number): string {
  return `${Math.round(v).toLocaleString("ru-RU")} ₽`;
}

/**
 * «Почему мы это предложили» (ТЗ §6): только фактические основания из
 * данных товара и ответов пользователя. Максимум 2-3 причины.
 */
export function describeHelpReasons(doc: SearchDoc, a: HelpChooseAnswers): string[] {
  const reasons: string[] = [];
  if (a.occasion && matchesOccasion(doc, a.occasion)) {
    reasons.push(`подходит для повода «${OCCASIONS[a.occasion].label.toLowerCase()}»`);
  }
  if (a.servingsMin !== null && doc.servings !== null && doc.servings >= a.servingsMin) {
    reasons.push(
      `рассчитан на ${doc.servings} ${pluralRu(doc.servings, "человека", "человек", "человек")}`
    );
  }
  if (a.priceMax !== null && doc.price > 0 && doc.price <= a.priceMax) {
    reasons.push(`укладывается в бюджет до ${formatPriceRub(a.priceMax)}`);
  }
  for (const key of a.excludeAllergens) {
    if (passesAllergen(doc, key)) {
      reasons.push(ALLERGEN_GROUPS[key].label.toLowerCase());
      break; // одну группу ограничений достаточно в подсказке
    }
  }
  if (a.tastes.length > 0) {
    const stem = wordStem(a.tastes[0]);
    const full = [doc.title, ...doc.texts, ...doc.tags].join(" ").toLowerCase();
    if (stem && full.includes(stem)) {
      reasons.push(`со вкусом «${a.tastes[0].toLowerCase()}»`);
    }
  }
  if (reasons.length === 0) {
    // основание из данных: рейтинг/популярность — тоже факт
    if (doc.rating > 0) {
      reasons.push(`рейтинг ${doc.rating.toString().replace(".", ",")} из 5`);
    } else {
      reasons.push("соответствует выбору каталога");
    }
  }
  return reasons.slice(0, 3);
}
