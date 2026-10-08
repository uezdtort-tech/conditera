/**
 * Серверные данные для P2.3 рекомендаций (общие для /api/products/[id]/similar
 * и /api/recommendations). Один источник данных, второй выборки нет.
 *
 * Пул: published-товары с полями карточки. Категория — slug из
 * product_categories (реальная категория БД, не угадывание); кондитер —
 * split-brain identity (products.confectioner_id = confectioners.userId).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  toRecommendationSubject,
  type Recommendation,
  type RecommendationSubject,
} from "@/lib/recommendations";

const PRODUCT_POOL_SELECT = `
  id, title, slug, description, short_description, long_description,
  filling_description, price, old_price, servings, weight_grams, tags,
  dietary_features, composition, is_available, rating_average, reviews_count,
  confectioner_id, category_id, images
`;

type ProductRow = Record<string, unknown>;

export interface RecommendationMeta {
  slug: string | null;
  images: string[];
  oldPrice: number | null;
  isAvailable: boolean;
  categorySlug: string | null;
  confectioner: { id: string; businessName: string; avatar: string } | null;
}

export interface RecommendationData {
  subjects: RecommendationSubject[];
  metaById: Map<string, RecommendationMeta>;
  /** карта category_id → slug (для сборки subject целевого товара) */
  slugById: Map<string, string>;
}

export function rowToSubject(
  row: ProductRow,
  slugById: Map<string, string>
): RecommendationSubject {
  return toRecommendationSubject({
    id: String(row.id),
    title: String(row.title ?? ""),
    description: (row.description as string | null) ?? null,
    shortDescription: (row.short_description as string | null) ?? null,
    longDescription: (row.long_description as string | null) ?? null,
    fillingDescription: (row.filling_description as string | null) ?? null,
    tags: (row.tags as string[] | null) ?? [],
    dietaryFeatures: (row.dietary_features as string[] | null) ?? [],
    composition:
      (row.composition as { ingredients?: string[]; allergens?: string[] } | null) ?? null,
    price: Number(row.price) || 0,
    servings: (row.servings as number | null) ?? null,
    weightGrams: (row.weight_grams as number | null) ?? null,
    isAvailable: row.is_available !== false,
    rating: Number(row.rating_average ?? 0),
    reviewsCount: Number(row.reviews_count ?? 0),
    confectionerId: (row.confectioner_id as string | null) ?? null,
    category: slugById.get(String(row.category_id)) ?? null,
  });
}

function metaOf(
  row: ProductRow,
  slugById: Map<string, string>,
  confectionerByUserId: Map<string, { id: string; businessName: string; avatar: string }>
): RecommendationMeta {
  const confId = (row.confectioner_id as string | null) ?? null;
  return {
    slug: (row.slug as string | null) ?? null,
    images: (row.images as string[] | null) ?? [],
    oldPrice: (row.old_price as number | null) ?? null,
    isAvailable: row.is_available !== false,
    categorySlug: slugById.get(String(row.category_id ?? "")) ?? null,
    confectioner:
      (confId && confectionerByUserId.get(confId)) || null,
  };
}

/** Пул рекомендаций: published-товары + карты категорий и кондитеров. */
export async function loadRecommendationData(): Promise<RecommendationData> {
  const [{ data: rows, error }, { data: cats }, { data: confs }] = await Promise.all([
    supabaseAdmin
      .from("products")
      .select(PRODUCT_POOL_SELECT)
      .eq("status", "published")
      .limit(500),
    supabaseAdmin.from("product_categories").select("id, slug"),
    supabaseAdmin.from("confectioners").select("id, userId, businessName, avatar"),
  ]);

  if (error) {
    throw new Error(`[recommendations] products query: ${error.message}`);
  }

  const slugById = new Map<string, string>();
  (cats || []).forEach((c: { id: string; slug: string | null }) => {
    if (c.slug) slugById.set(c.id, c.slug);
  });

  const confectionerByUserId = new Map<
    string,
    { id: string; businessName: string; avatar: string }
  >();
  (confs || []).forEach(
    (c: {
      id: string;
      userId: string | null;
      businessName: string | null;
      avatar: string | null;
    }) => {
      if (c.userId) {
        confectionerByUserId.set(c.userId, {
          id: c.id,
          businessName: c.businessName ?? "",
          avatar: c.avatar ?? "",
        });
      }
    }
  );

  const subjects: RecommendationSubject[] = [];
  const metaById = new Map<string, RecommendationMeta>();
  for (const row of (rows || []) as ProductRow[]) {
    const id = String(row.id);
    subjects.push(rowToSubject(row, slugById));
    metaById.set(id, metaOf(row, slugById, confectionerByUserId));
  }
  return { subjects, metaById, slugById };
}

/** Товар по UUID или slug (для target у /similar). */
export async function loadProductRowByIdOrSlug(
  idOrSlug: string
): Promise<ProductRow | null> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const base = supabaseAdmin
    .from("products")
    .select(PRODUCT_POOL_SELECT)
    .eq("status", "published")
    .limit(1);
  const { data } = UUID_RE.test(idOrSlug)
    ? await base.eq("id", idOrSlug)
    : await base.eq("slug", idOrSlug);
  return ((data || []) as ProductRow[])[0] ?? null;
}

/** Товары по списку id (любой статус — для якорей персонализации). */
export async function loadProductRowsByIds(ids: string[]): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("products")
    .select(PRODUCT_POOL_SELECT)
    .in("id", ids)
    .limit(500);
  if (error) {
    console.error("[recommendations] anchors query:", error.message);
    return [];
  }
  return (data || []) as ProductRow[];
}

/** Ответный item рекомендации (форма для UI). */
export function buildResponseItem(
  rec: Recommendation,
  metaById: Map<string, RecommendationMeta>
): Record<string, unknown> {
  const meta = metaById.get(rec.subject.id);
  return {
    id: rec.subject.id,
    title: rec.subject.doc.title,
    slug: meta?.slug ?? null,
    price: rec.subject.doc.price,
    oldPrice: meta?.oldPrice ?? null,
    images: meta?.images ?? [],
    servings: rec.subject.doc.servings,
    rating: rec.subject.doc.rating,
    reviewsCount: rec.subject.doc.reviewsCount,
    isAvailable: rec.subject.doc.isAvailable,
    categorySlug: meta?.categorySlug ?? null,
    confectioner: meta?.confectioner ?? null,
    score: Math.round(rec.score * 100) / 100,
    reasons: rec.reasons,
  };
}
