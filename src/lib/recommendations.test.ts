/**
 * Тесты P2.3 — детерминированные рекомендации.
 *
 * Проверяются: фактические причины («Потому что…»), детерминизм
 * сортировки, исключения (сам товар/избранное/заказанное/снятые с
 * продажи), персональные якоря (wishlist/история), честный fallback
 * по реальным отзывам.
 */

import { describe, expect, it } from "vitest";
import {
  anchorAffinity,
  fallbackReason,
  recommendForYou,
  recommendSimilar,
  scoreSimilarity,
  toRecommendationSubject,
  type RecommendationSubjectLike,
} from "./recommendations";

let seq = 0;

function mkProduct(overrides: Partial<RecommendationSubjectLike> = {}): RecommendationSubjectLike {
  seq += 1;
  return {
    id: `p-${seq}`,
    title: "Торт",
    description: "Вкусный десерт",
    price: 3000,
    servings: 10,
    tags: [],
    dietaryFeatures: [],
    rating: 4.5,
    reviewsCount: 10,
    isAvailable: true,
    confectionerId: "conf-1",
    category: "cakes",
    ...overrides,
  };
}

describe("recommendSimilar — базовая похожесть и причины", () => {
  it("та же категория даёт причину «Похожая категория»", () => {
    const target = toRecommendationSubject(mkProduct({ category: "cakes" }));
    const candidate = toRecommendationSubject(mkProduct({ category: "cakes" }));
    const result = recommendSimilar(target, [candidate]);
    expect(result).toHaveLength(1);
    expect(result[0].reasons).toContain("Похожая категория");
  });

  it("тот же кондитер даёт причину «От того же кондитера»", () => {
    const target = toRecommendationSubject(mkProduct({ confectionerId: "conf-9" }));
    const candidate = toRecommendationSubject(mkProduct({ confectionerId: "conf-9" }));
    const result = recommendSimilar(target, [candidate]);
    expect(result[0].reasons).toContain("От того же кондитера");
  });

  it("общий тег даёт причину «Похожий вкус: …»", () => {
    const target = toRecommendationSubject(mkProduct({ tags: ["Шоколад"] }));
    const candidate = toRecommendationSubject(
      mkProduct({ title: "Шоколадный бенто-торт" })
    );
    const result = recommendSimilar(target, [candidate]);
    expect(result[0].reasons.some((r) => r.startsWith("Похожий вкус"))).toBe(true);
  });

  it("совпадение повода даёт причину «Подходит для того же повода»", () => {
    const target = toRecommendationSubject(
      mkProduct({ description: "Торт на свадьбу", category: null })
    );
    const candidate = toRecommendationSubject(
      mkProduct({ title: "Свадебный ярусный торт", category: null, description: "" })
    );
    const result = recommendSimilar(target, [candidate]);
    expect(result[0].reasons).toContain("Подходит для того же повода");
  });

  it("совпадающая dietary-пометка даёт причину «Тоже …»", () => {
    const target = toRecommendationSubject(
      mkProduct({ dietaryFeatures: ["без сахара"], tags: [] })
    );
    const candidate = toRecommendationSubject(
      mkProduct({ dietaryFeatures: ["без сахара"], tags: [] })
    );
    const result = recommendSimilar(target, [candidate]);
    expect(result[0].reasons).toContain("Тоже «без сахара»");
  });

  it("известные порции дают честную причину о количестве человек", () => {
    const target = toRecommendationSubject(mkProduct({ servings: 12 }));
    const candidate = toRecommendationSubject(mkProduct({ servings: 12 }));
    const result = recommendSimilar(target, [candidate]);
    expect(result[0].reasons.some((r) => r.includes("рассчитан на 12 человек"))).toBe(true);
  });

  it("близкая цена даёт причину «Похожая цена»", () => {
    const target = toRecommendationSubject(
      mkProduct({ price: 3000, category: null, confectionerId: null, servings: null })
    );
    const candidate = toRecommendationSubject(
      mkProduct({ price: 3200, category: null, confectionerId: null, servings: null })
    );
    const result = recommendSimilar(target, [candidate]);
    expect(result[0].reasons).toContain("Похожая цена");
  });

  it("бюджет пользователя даёт причину «В вашем бюджете»", () => {
    const target = toRecommendationSubject(
      mkProduct({ price: 8000, category: null, confectionerId: null, servings: null })
    );
    const candidate = toRecommendationSubject(
      mkProduct({ price: 2500, category: null, confectionerId: null, servings: null })
    );
    const result = recommendSimilar(
      target,
      [candidate],
      { context: { budgetMax: 4000 } }
    );
    expect(result[0].reasons).toContain("В вашем бюджете");
  });

  it("причины ограничены тремя", () => {
    const target = toRecommendationSubject(
      mkProduct({
        tags: ["шоколад", "ягоды", "ваниль", "карамель"],
        category: "cakes",
        confectionerId: "conf-2",
      })
    );
    const candidate = toRecommendationSubject(
      mkProduct({
        tags: ["шоколад", "ягоды", "ваниль", "карамель"],
        category: "cakes",
        confectionerId: "conf-2",
      })
    );
    const result = recommendSimilar(target, [candidate]);
    expect(result[0].reasons.length).toBeLessThanOrEqual(3);
  });
});

describe("recommendSimilar — исключения и детерминизм", () => {
  it("сам товар не рекомендуется", () => {
    const target = toRecommendationSubject(mkProduct({ id: "same" }));
    const candidate = toRecommendationSubject(mkProduct({ id: "same" }));
    expect(recommendSimilar(target, [candidate])).toHaveLength(0);
  });

  it("товары, снятые с продажи, не рекомендуются", () => {
    const target = toRecommendationSubject(mkProduct({}));
    const off = toRecommendationSubject(mkProduct({ isAvailable: false }));
    expect(recommendSimilar(target, [off])).toHaveLength(0);
  });

  it("без единого сигнала сходства товар не попадает в выдачу", () => {
    const target = toRecommendationSubject(
      mkProduct({ tags: ["шафран"], category: "cakes", confectionerId: "a", price: 1000, servings: 4 })
    );
    const candidate = toRecommendationSubject(
      mkProduct({
        title: "Совершенно другой",
        description: "Другой десерт",
        tags: ["лаванда"],
        category: "macarons",
        confectionerId: "b",
        price: 9000,
        servings: 40,
      })
    );
    expect(recommendSimilar(target, [candidate])).toHaveLength(0);
  });

  it("сортировка детерминирована: score → rating → отзывы → id", () => {
    const target = toRecommendationSubject(mkProduct({ category: "cakes" }));
    const a = toRecommendationSubject(mkProduct({ category: "cakes", rating: 4.0, id: "aa" }));
    const b = toRecommendationSubject(mkProduct({ category: "cakes", rating: 4.9, id: "bb" }));
    const result = recommendSimilar(target, [a, b]);
    expect(result.map((r) => r.subject.id)).toEqual(["bb", "aa"]);
    // И повторный вызов даёт тот же порядок (без рандома)
    const again = recommendSimilar(target, [a, b]);
    expect(again.map((r) => r.subject.id)).toEqual(["bb", "aa"]);
  });

  it("уважает limit", () => {
    const target = toRecommendationSubject(mkProduct({}));
    const candidates = Array.from({ length: 5 }, () =>
      toRecommendationSubject(mkProduct({ category: "cakes" }))
    );
    expect(recommendSimilar(target, candidates, { limit: 2 })).toHaveLength(2);
  });

  it("excludeIds убирает кандидатов из выдачи", () => {
    const target = toRecommendationSubject(mkProduct({ category: "cakes" }));
    const candidate = toRecommendationSubject(mkProduct({ category: "cakes" }));
    const result = recommendSimilar(target, [candidate], {
      context: { excludeIds: [candidate.id] },
    });
    expect(result).toHaveLength(0);
  });
});

describe("персональные якоря (избранное / история заказов)", () => {
  it("якорь «избранное» даёт причину «Похоже на то, что вы добавляли в избранное»", () => {
    const target = toRecommendationSubject(mkProduct({ category: null }));
    const candidate = toRecommendationSubject(mkProduct({ category: null, tags: ["шоколад"] }));
    const wishlist = [toRecommendationSubject(mkProduct({ tags: ["шоколад"], category: null }))];
    const result = recommendSimilar(target, [candidate], { context: { wishlist } });
    expect(result[0].reasons[0]).toBe("Похоже на то, что вы добавляли в избранное");
  });

  it("якорь «история заказов» даёт причину «Похоже на то, что вы заказывали раньше»", () => {
    const target = toRecommendationSubject(mkProduct({ category: null, confectionerId: null }));
    const candidate = toRecommendationSubject(
      mkProduct({ category: null, confectionerId: null, tags: ["ягоды"] })
    );
    const history = [
      toRecommendationSubject(mkProduct({ category: null, confectionerId: null, tags: ["ягоды"] })),
    ];
    const result = recommendSimilar(target, [candidate], { context: { history } });
    expect(result[0].reasons[0]).toBe("Похоже на то, что вы заказывали раньше");
  });

  it("сами якоря (избранное/заказанное) не попадают в выдачу", () => {
    const target = toRecommendationSubject(mkProduct({}));
    const anchorProduct = mkProduct({});
    const wishlist = [toRecommendationSubject(anchorProduct)];
    const result = recommendSimilar(target, [toRecommendationSubject(anchorProduct)], {
      context: { wishlist },
    });
    expect(result).toHaveLength(0);
  });

  it("anchorAffinity: категория + вкус дают больший вес, чем только кондитер", () => {
    const anchor = toRecommendationSubject(
      mkProduct({ category: "cakes", confectionerId: "c1", tags: ["шоколад"] })
    );
    const strongCandidate = toRecommendationSubject(
      mkProduct({ category: "cakes", confectionerId: "c2", tags: ["шоколад"] })
    );
    const weakCandidate = toRecommendationSubject(
      mkProduct({ category: "macarons", confectionerId: "c1", tags: [] })
    );
    expect(anchorAffinity(anchor, strongCandidate)).toBeGreaterThan(
      anchorAffinity(anchor, weakCandidate)
    );
  });

  it("случайное сходство ниже порога не даёт персональной причины", () => {
    const target = toRecommendationSubject(mkProduct({}));
    const candidate = toRecommendationSubject(
      mkProduct({ category: "cakes", confectionerId: "conf-1" })
    );
    // Якорь не имеет с кандидатом ни категории, ни кондитера, ни общих тегов
    const wishlist = [
      toRecommendationSubject(
        mkProduct({ category: "macarons", confectionerId: "z9", tags: ["лаванда"], servings: 40, price: 9500 })
      ),
    ];
    const result = recommendSimilar(target, [candidate], { context: { wishlist } });
    expect(result[0].reasons).not.toContain("Похоже на то, что вы добавляли в избранное");
  });
});

describe("recommendForYou — «Вам может понравиться»", () => {
  it("с якорями: personalized=true и персональная причина", () => {
    const subjects = [
      toRecommendationSubject(mkProduct({ category: "cakes" })),
      toRecommendationSubject(mkProduct({ category: "macarons", tags: ["фисташка"] })),
    ];
    const wishlist = [toRecommendationSubject(mkProduct({ category: "cakes", id: "w1" }))];
    const { items, personalized } = recommendForYou(subjects, { context: { wishlist } });
    expect(personalized).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].reasons[0]).toBe("Похоже на то, что вы добавляли в избранное");
    // якорь сам не рекомендуется
    expect(items.some((i) => i.subject.id === "w1")).toBe(false);
  });

  it("без якорей (аноним): популярный fallback по реальным отзывам, personalized=false", () => {
    const subjects = [
      toRecommendationSubject(mkProduct({ reviewsCount: 3, rating: 5 })),
      toRecommendationSubject(mkProduct({ reviewsCount: 12, rating: 4.2 })),
    ];
    const { items, personalized } = recommendForYou(subjects);
    expect(personalized).toBe(false);
    expect(items[0].subject.doc.reviewsCount).toBe(12);
    expect(items[0].reasons[0]).toContain("12 отзывов");
  });

  it("снятые с продажи исключаются даже из fallback", () => {
    const subjects = [
      toRecommendationSubject(mkProduct({ reviewsCount: 30, isAvailable: false })),
      toRecommendationSubject(mkProduct({ reviewsCount: 2 })),
    ];
    const { items } = recommendForYou(subjects);
    expect(items).toHaveLength(1);
  });

  it("пустой каталог — пустая выдача без ошибок", () => {
    const { items, personalized } = recommendForYou([]);
    expect(items).toHaveLength(0);
    expect(personalized).toBe(false);
  });
});

describe("fallbackReason — только факты", () => {
  it("много отзывов → причина о популярности", () => {
    const doc = toRecommendationSubject(mkProduct({ reviewsCount: 7 })).doc;
    expect(fallbackReason(doc)).toBe("Популярен у покупателей: 7 отзывов");
  });

  it("мало отзывов, но есть рейтинг → причина о рейтинге", () => {
    const doc = toRecommendationSubject(mkProduct({ reviewsCount: 2, rating: 4.8 })).doc;
    expect(fallbackReason(doc)).toBe("Рейтинг 4,8 из 5");
  });

  it("нет данных → нейтральная причина без выдумок", () => {
    const doc = toRecommendationSubject(mkProduct({ reviewsCount: 0, rating: 0 })).doc;
    expect(fallbackReason(doc)).toBe("Выбор каталога");
  });
});

describe("scoreSimilarity — единичный вызов", () => {
  it("возвращает score и причины, score > 0 только при реальном сигнале", () => {
    const target = toRecommendationSubject(mkProduct({ category: "cakes" }));
    const similar = toRecommendationSubject(mkProduct({ category: "cakes" }));
    const different = toRecommendationSubject(
      mkProduct({ category: "macarons", confectionerId: "x", price: 9500, servings: 40, tags: ["лаванда"] })
    );
    expect(scoreSimilarity(target, similar).score).toBeGreaterThan(0);
    expect(scoreSimilarity(target, different).score).toBeGreaterThanOrEqual(0);
  });
});
