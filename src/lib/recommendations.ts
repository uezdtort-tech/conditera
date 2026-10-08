/**
 * P2.3 — детерминированные рекомендации (ТЗ §9-§11, §15).
 *
 * ЕДИНСТВЕННЫЙ механизм «похожих товаров» и «Вам может понравиться».
 * Построен ПОВЕРХ единого поискового движка (product-search.ts): те же
 * SearchDoc, та же морфология, те же слова поводов. Второго движка нет.
 *
 * Правила (из ТЗ P2 и ревью P2.3):
 *   • только deterministic scoring — никаких ML, embeddings, «AI считает»;
 *   • каждая рекомендация имеет ФАКТИЧЕСКУЮ причину («Похожая категория»,
 *     «От того же кондитера», «Похожий вкус: …», «Похоже на то, что вы
 *     заказывали раньше») — причины выводятся только из реальных данных;
 *   • популярность учитывается только по надёжному показателю
 *     reviews_count (реальные отзывы); sales_count/views_count не
 *     используются — их достоверность не подтверждена;
 *   • товары, снятые с продажи (is_available = false), не рекомендуются;
 *   • сам товар, избранное и уже заказанное не рекомендуются повторно —
 *     только как якоря сходства;
 *   • сортировка полностью детерминирована (score → rating → отзывы → id).
 */

import {
  OCCASIONS,
  toSearchDoc,
  wordStem,
  type OccasionKey,
  type SearchDoc,
  type SearchableProductLike,
} from "./product-search";

/* ------------------------------------------------------------------ *
 * Субъект рекомендации                                                *
 * ------------------------------------------------------------------ */

/** Товар в терминах рекомендаций: поисковый документ + ключи сходства. */
export interface RecommendationSubject {
  id: string;
  doc: SearchDoc;
  confectionerId: string | null;
  /** Категория (slug или другой стабильный ключ — сравнивается на равенство) */
  category: string | null;
}

/** Атрибуты товара, достаточные для сборки RecommendationSubject. */
export interface RecommendationSubjectLike extends SearchableProductLike {
  confectionerId?: string | null;
  category?: string | null;
}

export function toRecommendationSubject(
  p: RecommendationSubjectLike
): RecommendationSubject {
  return {
    id: p.id,
    doc: toSearchDoc(p),
    confectionerId: p.confectionerId ?? null,
    category: p.category ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Контекст персонализации                                             *
 * ------------------------------------------------------------------ */

/** Якорь персонализации: товар из избранного или из истории заказов. */
export interface PersonalAnchor {
  kind: "wishlist" | "history";
  subject: RecommendationSubject;
}

export interface RecommendationContext {
  /** Избранное пользователя (якоря сходства; сами не рекомендуются) */
  wishlist?: RecommendationSubject[];
  /** Ранее заказанные товары (якоря; сами не рекомендуются) */
  history?: RecommendationSubject[];
  /** Потолок бюджета пользователя (для причины «В вашем бюджете») */
  budgetMax?: number | null;
  /** Явные исключения из выдачи (кроме самого товара/якорей) */
  excludeIds?: string[];
}

/* ------------------------------------------------------------------ *
 * Веса (детерминированные, документированные)                         *
 * ------------------------------------------------------------------ */

export const RECOMMENDATION_WEIGHTS = {
  sameConfectioner: 30,
  sameCategory: 24,
  tasteMatch: 8, // за каждый общий тег-вкус, не более 16
  tasteCap: 16,
  dietaryMatch: 5, // за совпадающую dietary-пометку, не более 10
  dietaryCap: 10,
  occasionMatch: 10,
  priceClose: 14, // расхождение ≤ 15%
  priceNear: 9, // ≤ 30%
  priceFar: 4, // ≤ 50%
  budgetFit: 6,
  servingsSame: 8,
  servingsNear: 6,
  anchorWishlist: 12, // максимум за сходство с избранным
  anchorHistory: 10, // максимум за сходство с заказанным
  anchorMinAffinity: 6, // ниже — сходство считается случайным
  ratingBoost: 6, // rating ≥ 4.5 и ≥ 3 отзывов (tie-break)
  popularityBoostMax: 6, // min(6, floor(reviews_count / 5))
} as const;

/* ------------------------------------------------------------------ *
 * Внутренние помощники                                                *
 * ------------------------------------------------------------------ */

function haystackOf(doc: SearchDoc): string {
  return [
    doc.title,
    ...doc.texts,
    ...doc.tags,
    ...doc.dietary,
    ...doc.compositionTexts,
  ]
    .join(" ")
    .toLowerCase()
    .replace(/ё/g, "е");
}

/** Стемы тега (тег может быть многословным: «красный бархат»). */
function tagStems(tag: string): string[] {
  return tag
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .map(wordStem)
    .filter(Boolean);
}

/** Общий «вкус»: теги целика совпадают по всем словам своего стема. */
function sharedTasteTags(a: SearchDoc, b: SearchDoc): string[] {
  const hay = haystackOf(b);
  const out: string[] = [];
  for (const tag of a.tags) {
    const stems = tagStems(tag);
    if (stems.length === 0) continue;
    if (stems.every((s) => hay.includes(s))) out.push(tag);
  }
  return out;
}

/** Поводы, к которым реально относится товар (по словам из данных). */
function occasionKeysOf(doc: SearchDoc): OccasionKey[] {
  const hay = haystackOf(doc);
  const out: OccasionKey[] = [];
  for (const key of Object.keys(OCCASIONS) as OccasionKey[]) {
    if (OCCASIONS[key].stems.some((s) => hay.includes(s))) out.push(key);
  }
  return out.slice(0, 2);
}

function dietaryOverlap(a: SearchDoc, b: SearchDoc): string[] {
  const norm = (v: string) => v.toLowerCase().replace(/ё/g, "е").trim();
  const bSet = new Set(b.dietary.map(norm));
  return a.dietary.map(norm).filter((v) => v && bSet.has(v));
}

/**
 * Сходство с якорем персонализации (избранное/заказанное).
 * 0 — нет реального сигнала; иначе суммарный вес.
 */
export function anchorAffinity(
  anchor: RecommendationSubject,
  candidate: RecommendationSubject
): number {
  let score = 0;
  if (
    anchor.confectionerId &&
    candidate.confectionerId &&
    anchor.confectionerId === candidate.confectionerId
  ) {
    score += 6;
  }
  if (anchor.category && candidate.category && anchor.category === candidate.category) {
    score += 10;
  }
  const tastes = sharedTasteTags(anchor.doc, candidate.doc);
  if (tastes.length > 0) score += Math.min(10, tastes.length * 8);
  const anchorOcc = occasionKeysOf(anchor.doc);
  if (
    anchorOcc.length > 0 &&
    occasionKeysOf(candidate.doc).some((k) => anchorOcc.includes(k))
  ) {
    score += 6;
  }
  return score;
}

/** Относительное расхождение цен (0 — одинаковые, 1 — отличаются в 2 раза). */
function priceRelDiff(a: number, b: number): number | null {
  if (a <= 0 || b <= 0) return null;
  return Math.abs(a - b) / Math.max(a, b);
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/* ------------------------------------------------------------------ *
 * Скоринг «похожести» + причины                                       *
 * ------------------------------------------------------------------ */

export interface SimilarityResult {
  score: number;
  reasons: string[];
}

/**
 * Детерминированная «похожесть» кандидата на целевой товар.
 * Причины собираются в порядке приоритета (персональные — выше) и
 * обрезаются до 3 — как в «Помочь выбрать».
 */
export function scoreSimilarity(
  target: RecommendationSubject,
  candidate: RecommendationSubject,
  context: RecommendationContext = {}
): SimilarityResult {
  let score = 0;
  let hasSignal = false;
  const reasons: string[] = [];
  const push = (weight: number, reason?: string) => {
    hasSignal = true;
    score += weight;
    if (reason) reasons.push(reason);
  };

  // --- Персональные якоря (высший приоритет в объяснении) ---
  let wishlistBest = 0;
  let historyBest = 0;
  for (const anchor of context.wishlist ?? []) {
    if (anchor.id === candidate.id) continue;
    wishlistBest = Math.max(wishlistBest, anchorAffinity(anchor, candidate));
  }
  for (const anchor of context.history ?? []) {
    if (anchor.id === candidate.id) continue;
    historyBest = Math.max(historyBest, anchorAffinity(anchor, candidate));
  }
  if (wishlistBest >= RECOMMENDATION_WEIGHTS.anchorMinAffinity) {
    push(
      Math.min(RECOMMENDATION_WEIGHTS.anchorWishlist, wishlistBest),
      "Похоже на то, что вы добавляли в избранное"
    );
  }
  if (historyBest >= RECOMMENDATION_WEIGHTS.anchorMinAffinity) {
    push(
      Math.min(RECOMMENDATION_WEIGHTS.anchorHistory, historyBest),
      "Похоже на то, что вы заказывали раньше"
    );
  }

  // --- Сходство с целевым товаром ---
  if (
    target.confectionerId &&
    candidate.confectionerId &&
    target.confectionerId === candidate.confectionerId
  ) {
    push(RECOMMENDATION_WEIGHTS.sameConfectioner, "От того же кондитера");
  }

  const tastes = sharedTasteTags(target.doc, candidate.doc);
  if (tastes.length > 0) {
    push(
      Math.min(RECOMMENDATION_WEIGHTS.tasteCap, tastes.length * RECOMMENDATION_WEIGHTS.tasteMatch),
      `Похожий вкус: «${tastes[0].toLowerCase()}»`
    );
  }

  if (target.category && candidate.category && target.category === candidate.category) {
    push(RECOMMENDATION_WEIGHTS.sameCategory, "Похожая категория");
  }

  const targetOcc = occasionKeysOf(target.doc);
  if (
    targetOcc.length > 0 &&
    occasionKeysOf(candidate.doc).some((k) => targetOcc.includes(k))
  ) {
    push(RECOMMENDATION_WEIGHTS.occasionMatch, "Подходит для того же повода");
  }

  const dietary = dietaryOverlap(target.doc, candidate.doc);
  if (dietary.length > 0) {
    push(
      Math.min(RECOMMENDATION_WEIGHTS.dietaryCap, dietary.length * RECOMMENDATION_WEIGHTS.dietaryMatch),
      `Тоже «${dietary[0]}»`
    );
  }

  if (target.doc.servings !== null && candidate.doc.servings !== null) {
    const ratio =
      Math.max(target.doc.servings, candidate.doc.servings) /
      Math.min(target.doc.servings, candidate.doc.servings);
    if (ratio === 1) {
      push(
        RECOMMENDATION_WEIGHTS.servingsSame,
        `Тоже рассчитан на ${candidate.doc.servings} ${pluralRu(candidate.doc.servings, "человека", "человек", "человек")}`
      );
    } else if (ratio <= 1.3) {
      push(
        RECOMMENDATION_WEIGHTS.servingsNear,
        `Тоже рассчитан на ${candidate.doc.servings} ${pluralRu(candidate.doc.servings, "человека", "человек", "человек")}`
      );
    }
  }

  const relDiff = priceRelDiff(target.doc.price, candidate.doc.price);
  if (relDiff !== null) {
    if (relDiff <= 0.15) push(RECOMMENDATION_WEIGHTS.priceClose, "Похожая цена");
    else if (relDiff <= 0.3) push(RECOMMENDATION_WEIGHTS.priceNear, "Похожая цена");
    else if (relDiff <= 0.5) push(RECOMMENDATION_WEIGHTS.priceFar);
  }

  if (
    typeof context.budgetMax === "number" &&
    context.budgetMax > 0 &&
    candidate.doc.price > 0 &&
    candidate.doc.price <= context.budgetMax
  ) {
    push(RECOMMENDATION_WEIGHTS.budgetFit, "В вашем бюджете");
  }

  // --- Tie-break по надёжным показателям — только при реальном сигнале ---
  if (hasSignal) {
    if (candidate.doc.rating >= 4.5 && candidate.doc.reviewsCount >= 3) {
      score += RECOMMENDATION_WEIGHTS.ratingBoost;
    }
    score += Math.min(
      RECOMMENDATION_WEIGHTS.popularityBoostMax,
      Math.floor(candidate.doc.reviewsCount / 5)
    );
  }

  if (!hasSignal) return { score: 0, reasons: [] };
  return { score, reasons: reasons.slice(0, 3) };
}

/** Fallback-причина из фактов товара (когда персональных оснований нет). */
export function fallbackReason(doc: SearchDoc): string {
  if (doc.reviewsCount >= 5) {
    return `Популярен у покупателей: ${doc.reviewsCount} ${pluralRu(doc.reviewsCount, "отзыв", "отзыва", "отзывов")}`;
  }
  if (doc.rating > 0) {
    return `Рейтинг ${doc.rating.toString().replace(".", ",")} из 5`;
  }
  return "Выбор каталога";
}

/* ------------------------------------------------------------------ *
 * Детерминированная сортировка                                        *
 * ------------------------------------------------------------------ */

function compareRecommendations(a: Recommendation, b: Recommendation): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.subject.doc.rating !== a.subject.doc.rating) {
    return b.subject.doc.rating - a.subject.doc.rating;
  }
  if (b.subject.doc.reviewsCount !== a.subject.doc.reviewsCount) {
    return b.subject.doc.reviewsCount - a.subject.doc.reviewsCount;
  }
  return a.subject.id.localeCompare(b.subject.id);
}

export interface Recommendation {
  subject: RecommendationSubject;
  score: number;
  reasons: string[];
}

/* ------------------------------------------------------------------ *
 * «Похожие товары» (карточка товара, ТЗ §9)                           *
 * ------------------------------------------------------------------ */

export interface RecommendSimilarOptions {
  limit?: number;
  context?: RecommendationContext;
}

/**
 * Похожие товары для карточки: candidate ≠ target, в продаже,
 * score > 0 (хотя бы один реальный сигнал сходства).
 */
export function recommendSimilar(
  target: RecommendationSubject,
  candidates: RecommendationSubject[],
  options: RecommendSimilarOptions = {}
): Recommendation[] {
  const { limit = 6, context = {} } = options;
  const excluded = new Set<string>([
    target.id,
    ...(context.wishlist ?? []).map((a) => a.id),
    ...(context.history ?? []).map((a) => a.id),
    ...(context.excludeIds ?? []),
  ]);

  const out: Recommendation[] = [];
  for (const candidate of candidates) {
    if (excluded.has(candidate.id)) continue;
    if (!candidate.doc.isAvailable) continue; // снятые с продажи не рекомендуем
    const { score, reasons } = scoreSimilarity(target, candidate, context);
    if (score <= 0) continue; // нет ни одного реального сигнала
    out.push({
      subject: candidate,
      score,
      reasons: reasons.length > 0 ? reasons : [fallbackReason(candidate.doc)],
    });
  }
  out.sort(compareRecommendations);
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * «Вам может понравиться» (главная, ТЗ §9 ⑥; персонализация §15)      *
 * ------------------------------------------------------------------ */

export interface RecommendForYouOptions {
  limit?: number;
  context?: RecommendationContext;
}

/**
 * Персональные рекомендации: якоря — избранное и история заказов.
 * Без якорей (аноним / чистый аккаунт) — детерминированный популярный
 * fallback по надёжным показателям (reviews_count → rating).
 */
export function recommendForYou(
  subjects: RecommendationSubject[],
  options: RecommendForYouOptions = {}
): { items: Recommendation[]; personalized: boolean } {
  const { limit = 6, context = {} } = options;
  const anchors: PersonalAnchor[] = [
    ...(context.wishlist ?? []).map((subject) => ({ kind: "wishlist" as const, subject })),
    ...(context.history ?? []).map((subject) => ({ kind: "history" as const, subject })),
  ];

  const excluded = new Set<string>([
    ...anchors.map((a) => a.subject.id),
    ...(context.excludeIds ?? []),
  ]);

  const pool = subjects.filter((s) => !excluded.has(s.id) && s.doc.isAvailable);

  if (anchors.length > 0) {
    const out: Recommendation[] = [];
    for (const candidate of pool) {
      // Максимальное сходство с любым якорем — детерминированно.
      let best = 0;
      let bestAnchor: PersonalAnchor | null = null;
      for (const anchor of anchors) {
        const affinity = anchorAffinity(anchor.subject, candidate);
        if (affinity > best) {
          best = affinity;
          bestAnchor = anchor;
        }
      }
      if (best < RECOMMENDATION_WEIGHTS.anchorMinAffinity || !bestAnchor) continue;

      const personalReason =
        bestAnchor.kind === "wishlist"
          ? "Похоже на то, что вы добавляли в избранное"
          : "Похоже на то, что вы заказывали раньше";

      // Дополнительные фактические причины от лучшего якоря.
      const extra: string[] = [];
      const tastes = sharedTasteTags(bestAnchor.subject.doc, candidate.doc);
      if (tastes.length > 0) extra.push(`Похожий вкус: «${tastes[0].toLowerCase()}»`);
      if (
        bestAnchor.subject.category &&
        candidate.category &&
        bestAnchor.subject.category === candidate.category
      ) {
        extra.push("Похожая категория");
      }
      const anchorOcc = occasionKeysOf(bestAnchor.subject.doc);
      if (
        anchorOcc.length > 0 &&
        occasionKeysOf(candidate.doc).some((k) => anchorOcc.includes(k))
      ) {
        extra.push("Подходит для того же повода");
      }

      const popularity = Math.min(
        RECOMMENDATION_WEIGHTS.popularityBoostMax,
        Math.floor(candidate.doc.reviewsCount / 5)
      );
      const ratingBoost =
        candidate.doc.rating >= 4.5 && candidate.doc.reviewsCount >= 3
          ? RECOMMENDATION_WEIGHTS.ratingBoost
          : 0;
      out.push({
        subject: candidate,
        score: best + popularity + ratingBoost,
        reasons: [personalReason, ...extra].slice(0, 3),
      });
    }
    out.sort(compareRecommendations);
    return { items: out.slice(0, limit), personalized: true };
  }

  // Fallback: популярное по реальным отзывам (детерминировано).
  const items = [...pool]
    .sort((a, b) => {
      if (b.doc.reviewsCount !== a.doc.reviewsCount) {
        return b.doc.reviewsCount - a.doc.reviewsCount;
      }
      if (b.doc.rating !== a.doc.rating) return b.doc.rating - a.doc.rating;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit)
    .map((subject) => ({
      subject,
      score: 0,
      reasons: [fallbackReason(subject.doc)],
    }));
  return { items, personalized: false };
}
