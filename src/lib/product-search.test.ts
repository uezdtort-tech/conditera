/**
 * Тесты единого поискового движка каталога (P2.1).
 * Детерминированный разбор запроса + скоринг по реальным данным товара.
 */
import { describe, it, expect } from "vitest";
import {
  parseQueryIntent,
  scoreSearchDoc,
  filterAndRank,
  toSearchDoc,
  wordStem,
  answersToIntent,
  readyByDate,
  describeHelpReasons,
  type SearchDoc,
  type QueryIntent,
} from "./product-search";

function doc(p: Partial<SearchDoc> & { id: string; title: string }): SearchDoc {
  return {
    texts: [],
    tags: [],
    dietary: [],
    compositionTexts: [],
    price: 1000,
    servings: null,
    weightGrams: null,
    isAvailable: true,
    rating: 4.8,
    reviewsCount: 10,
    ...p,
  };
}

const emptyIntent: QueryIntent = {
  tokens: [],
  priceMin: null,
  priceMax: null,
  servingsMin: null,
  occasion: null,
  excludeAllergens: [],
  genericExcludes: [],
  tastes: [],
};

describe("wordStem — морфология через префикс", () => {
  it("красный → красн (находит «красных»)", () => {
    expect(wordStem("красный")).toBe("красн");
    expect("красных ягод".includes(wordStem("красный"))).toBe(true);
  });

  it("шоколадный → шокол (находит «шоколад» и «шоколадные»)", () => {
    expect(wordStem("шоколадный")).toBe("шокол");
    expect("шоколадные конфеты".includes(wordStem("шоколадный"))).toBe(true);
    expect("шоколад".includes(wordStem("шоколадный"))).toBe(true);
  });

  it("короткие слова не укорачиваются", () => {
    expect(wordStem("торт")).toBe("торт");
    expect(wordStem("Ёлка")).toBe("елка");
  });
});

describe("parseQueryIntent — детерминированный разбор", () => {
  it("«торт на 10 человек до 4000 без орехов»", () => {
    const i = parseQueryIntent("торт на 10 человек до 4000 без орехов");
    expect(i.tokens).toEqual(["торт"]);
    expect(i.servingsMin).toBe(10);
    expect(i.priceMax).toBe(4000);
    expect(i.excludeAllergens).toContain("nuts");
  });

  it("«до 4 000 ₽» — бюджет с пробелами и знаком валюты", () => {
    expect(parseQueryIntent("торт до 4 000 ₽").priceMax).toBe(4000);
    expect(parseQueryIntent("десерт до 3500 рублей").priceMax).toBe(3500);
  });

  it("«от 2000 ₽» — нижняя граница цены", () => {
    expect(parseQueryIntent("торт от 2000 ₽").priceMin).toBe(2000);
  });

  it("«на 20 гостей» — порции", () => {
    expect(parseQueryIntent("набор на 20 гостей").servingsMin).toBe(20);
    expect(parseQueryIntent("15 порций").servingsMin).toBe(15);
  });

  it("«торт на день рождения» — повод birthday", () => {
    const i = parseQueryIntent("торт на день рождения");
    expect(i.occasion).toBe("birthday");
  });

  it("«без глютена» и «без молока» — группы аллергенов", () => {
    const i = parseQueryIntent("десерт без глютена без молока");
    expect(i.excludeAllergens).toContain("gluten");
    expect(i.excludeAllergens).toContain("lactose");
  });

  it("«без мастики» — произвольное исключение", () => {
    const i = parseQueryIntent("торт без мастики");
    expect(i.genericExcludes).toContain("масти");
  });

  it("«шоколадный торт» — два токена", () => {
    expect(parseQueryIntent("шоколадный торт").tokens).toEqual(["шокол", "торт"]);
  });

  it("пустой запрос — пустой интент", () => {
    const i = parseQueryIntent("   ");
    expect(i.tokens).toEqual([]);
    expect(i.priceMax).toBeNull();
    expect(i.occasion).toBeNull();
  });
});

describe("scoreSearchDoc — скоринг и фильтры", () => {
  const svadebnyy = doc({
    id: "1",
    title: "Свадебный торт «Ягодный бархат»",
    texts: ["мусс из красных ягод и бархатными коржами"],
    tags: ["свадебный", "ягодный", "мусс"],
    dietary: ["без консервантов"],
    price: 18500,
    servings: 35,
    reviewsCount: 12,
  });

  const candyBar = doc({
    id: "2",
    title: "Кэнди-бар шоколадный (30 персон)",
    texts: ["Ассорти из 6 видов конфет: трюфели, пралине, карамель"],
    tags: ["шоколад", "кэнди-бар"],
    dietary: ["содержит орехи"],
    price: 5900,
    servings: 30,
  });

  it("«шоколадный торт» находит кэнди-бар по слову «шоколад»", () => {
    const intent = parseQueryIntent("шоколадный торт");
    expect(scoreSearchDoc(candyBar, intent)).not.toBeNull();
  });

  it("«торт красный бархат» ставит свадебный торт выше", () => {
    const intent = parseQueryIntent("торт красный бархат");
    const sSvad = scoreSearchDoc(svadebnyy, intent) ?? 0;
    const sCandy = scoreSearchDoc(candyBar, intent) ?? 0;
    expect(sSvad).toBeGreaterThan(0);
    expect(sSvad).toBeGreaterThan(sCandy);
  });

  it("«торт без орехов» исключает «содержит орехи» и «фисташка»", () => {
    const intent = parseQueryIntent("торт без орехов");
    expect(scoreSearchDoc(candyBar, intent)).toBeNull();
    const makarons = doc({
      id: "3",
      title: "Макаронс ассорти",
      texts: ["от фисташки до солёной карамели"],
      dietary: ["содержит орехи"],
      price: 2600,
    });
    expect(scoreSearchDoc(makarons, intent)).toBeNull();
  });

  it("«без орехов» не исключает товар без данных об орехах", () => {
    const intent = parseQueryIntent("без орехов");
    expect(scoreSearchDoc(svadebnyy, intent)).not.toBeNull();
  });

  it("«без сахара» сохраняет товар с пометкой «без сахара»", () => {
    const pastila = doc({
      id: "4",
      title: "Пастила яблочная без сахара",
      texts: ["Без сахара, глютена и консервантов"],
      dietary: ["без сахара", "без глютена", "веган"],
      price: 690,
    });
    const intent = parseQueryIntent("пастила без сахара");
    expect(scoreSearchDoc(pastila, intent)).not.toBeNull();
    const withSugar = doc({
      id: "5",
      title: "Торт кремовый",
      compositionTexts: ["Мука пшеничная", "Сахар", "Масло сливочное"],
      price: 1500,
    });
    expect(scoreSearchDoc(withSugar, intent)).toBeNull();
  });

  it("«без молока» исключает «молочные продукты»", () => {
    const napoleon = doc({
      id: "6",
      title: "Домашний «Наполеон»",
      dietary: ["содержит глютен", "молочные продукты"],
      price: 2400,
    });
    const intent = parseQueryIntent("десерт без молока");
    expect(scoreSearchDoc(napoleon, intent)).toBeNull();
  });

  it("известное число порций меньше запрошенного — честный фильтр", () => {
    const bento = doc({ id: "7", title: "Бенто-торт", servings: 2, price: 1200 });
    const napoleon = doc({ id: "8", title: "Наполеон", servings: 12, price: 2400 });
    const unknown = doc({ id: "9", title: "Капкейки", servings: null, price: 900 });
    const intent: QueryIntent = { ...emptyIntent, servingsMin: 10 };
    expect(scoreSearchDoc(bento, intent)).toBeNull();
    expect(scoreSearchDoc(napoleon, intent)).not.toBeNull();
    // порции неизвестны — товар не отбрасываем
    expect(scoreSearchDoc(unknown, intent)).not.toBeNull();
  });

  it("бюджет отсекает более дорогие товары", () => {
    const intent: QueryIntent = { ...emptyIntent, priceMax: 4000 };
    expect(scoreSearchDoc(svadebnyy, intent)).toBeNull();
    expect(scoreSearchDoc(doc({ id: "10", title: "Бенто", price: 1200 }), intent)).not.toBeNull();
  });

  it("повод wedding матчится по тегу «свадебный»", () => {
    const intent: QueryIntent = { ...emptyIntent, occasion: "wedding" };
    expect(scoreSearchDoc(svadebnyy, intent)).not.toBeNull();
    expect(scoreSearchDoc(candyBar, intent)).toBeNull();
  });

  it("вкусы — must-have: «шоколад» без товара с шоколадом → null", () => {
    const intent: QueryIntent = { ...emptyIntent, tastes: ["шоколад"] };
    expect(scoreSearchDoc(candyBar, intent)).not.toBeNull();
    expect(scoreSearchDoc(svadebnyy, intent)).toBeNull();
  });

  it("пустой интент — все товары проходят со score 0", () => {
    expect(scoreSearchDoc(svadebnyy, emptyIntent)).toBe(0);
  });
});

describe("filterAndRank — ранжирование", () => {
  const docs = [
    doc({ id: "a", title: "Торт ягодный", reviewsCount: 5, rating: 4.5, texts: ["ягоды"] }),
    doc({ id: "b", title: "Торт шоколадный", reviewsCount: 50, rating: 4.9, texts: ["шоколад"] }),
    doc({ id: "c", title: "Капкейки", reviewsCount: 30, rating: 4.7 }),
  ];

  it("с токенами — сначала релевантность, потом популярность", () => {
    const intent = parseQueryIntent("шоколадный торт");
    const { items, total } = filterAndRank(docs, intent);
    expect(total).toBe(2);
    expect(items[0].id).toBe("b");
  });

  it("без токенов — сортировка popular", () => {
    const { items } = filterAndRank(docs, emptyIntent, { sort: "popular" });
    expect(items.map((d) => d.id)).toEqual(["b", "c", "a"]);
  });

  it("limit/offset пагинация", () => {
    const { items, total } = filterAndRank(docs, emptyIntent, { limit: 2, offset: 1 });
    expect(total).toBe(3);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("c");
  });

  it("price-asc сортировка", () => {
    const sorted = [
      doc({ id: "x", title: "Дорогой", price: 5000 }),
      doc({ id: "y", title: "Дешёвый", price: 500 }),
    ];
    const { items } = filterAndRank(sorted, emptyIntent, { sort: "price-asc" });
    expect(items[0].id).toBe("y");
  });
});

describe("toSearchDoc — сборка документа из товара витрины", () => {
  it("собирает тексты, теги, dietary и composition", () => {
    const d = toSearchDoc({
      id: "p1",
      title: "Бенто-торт",
      description: "Мини-торт",
      shortDescription: "на двоих",
      longDescription: "с надписью",
      fillingDescription: "малиновое пюре",
      tags: ["бенто", "подарок"],
      dietaryFeatures: ["содержит орехи"],
      composition: { ingredients: ["Мука"], allergens: ["Орехи"] },
      price: 1200,
      servings: 2,
      isAvailable: true,
      rating: 4.8,
      reviewsCount: 40,
    });
    expect(d.texts).toHaveLength(4);
    expect(d.dietary).toEqual(["содержит орехи"]);
    expect(d.compositionTexts).toEqual(["Мука", "Орехи"]);
    expect(d.servings).toBe(2);
    expect(d.isAvailable).toBe(true);
  });

  it("пустые/битые поля не ломают документ", () => {
    const d = toSearchDoc({ id: "p2", title: "Т", price: 100 });
    expect(d.servings).toBeNull();
    expect(d.isAvailable).toBe(true);
    expect(d.dietary).toEqual([]);
  });
});

describe("P2.2 — answersToIntent / readyByDate / describeHelpReasons", () => {
  const answers = {
    occasion: "birthday" as const,
    servingsMin: 10,
    priceMax: 4000,
    tastes: ["шоколад"],
    excludeAllergens: ["nuts" as const],
    when: "tomorrow" as const,
  };

  it("answersToIntent — ответы → интент движка (стемы вкусов)", () => {
    const intent = answersToIntent(answers);
    expect(intent.occasion).toBe("birthday");
    expect(intent.servingsMin).toBe(10);
    expect(intent.priceMax).toBe(4000);
    expect(intent.tastes).toContain(wordStem("шоколад"));
    expect(intent.excludeAllergens).toContain("nuts");
    expect(intent.tokens).toEqual([]);
  });

  it("готовность к «завтра»: 12 ч успевает, 72 ч — нет («Ближайшая дата»)", () => {
    const now = new Date("2026-02-10T12:00:00");
    const fast = readyByDate(12, "tomorrow", now);
    expect(fast.available).toBe(true);
    const slow = readyByDate(72, "tomorrow", now);
    expect(slow.available).toBe(false);
    expect(slow.readyAt).not.toBeNull();
  });

  it("«сегодня» при 12 ч производства — не успевает к концу дня", () => {
    const now = new Date("2026-02-10T18:00:00");
    const r = readyByDate(12, "today", now);
    expect(r.available).toBe(false);
  });

  it("неизвестный срок производства — доступность не запрещаем", () => {
    expect(readyByDate(null, "today", new Date("2026-02-10T18:00:00")).available).toBe(true);
    expect(readyByDate(0, "tomorrow", new Date()).available).toBe(true);
  });

  it("гибкая дата — всегда available без readyAt", () => {
    const r = readyByDate(500, null, new Date());
    expect(r.available).toBe(true);
    expect(r.readyAt).toBeNull();
  });

  it("describeHelpReasons — только фактические основания", () => {
    const bento = toSearchDoc({
      id: "b1",
      title: "Бенто-торт «Нежность»",
      description: "Мини-торт на двоих — идеальный подарок",
      tags: ["бенто", "подарок"],
      price: 1200,
      servings: 2,
      rating: 4.8,
      reviewsCount: 40,
    });
    const reasons = describeHelpReasons(bento, {
      occasion: "gift",
      servingsMin: 2,
      priceMax: 1500,
      tastes: [],
      excludeAllergens: [],
      when: null,
    });
    expect(reasons.some((r) => r.includes("подарок") || r.includes("повода"))).toBe(true);
    // причина бюджета содержит ПОТОЛОК (1 500 ₽; локальный пробел может быть U+202F)
    expect(reasons.some((r) => /1[\s\u00A0\u202F]?500/.test(r))).toBe(true);
  });

  it("describeHelpReasons — при отсутствии совпадений даёт факт о рейтинге", () => {
    const d = toSearchDoc({ id: "x", title: "Торт", price: 9000, servings: 30, rating: 4.9 });
    const reasons = describeHelpReasons(d, { ...answers, occasion: "wedding" });
    expect(reasons.length).toBeGreaterThan(0);
  });
});
