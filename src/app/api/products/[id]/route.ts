/**
 * GET /api/products/[id] — карточка товара (public).
 *
 * Ранее эндпоинт отсутствовал: запрос /api/products/{id} проваливался в
 * HTML-страницу с 200 вместо JSON — нарушение API-контракта. UI брал
 * карточку только из гидрированного стора (список /api/products), прямые
 * ссылки/внешние клиенты работали некорректно.
 *
 * Резолв: UUID или slug.
 * Enrichment (зеркало GET /api/products):
 *   - confectioner (products.confectioner_id = auth-UUID → confectioners.userId)
 *   - images: products.images (text[], сид 0005) ∪ product_images (загрузки)
 *   - slices: product_slices (фото разреза, fallback для карточки)
 *   - reviews: product_reviews (status='approved') + имена из profiles
 *
 * 404 JSON, если товар не найден или не published.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!id || id.length > 200) {
      return NextResponse.json({ error: "Некорректный идентификатор товара" }, { status: 400 });
    }

    // UUID → ищем по id, иначе по slug
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .select(`
        id, title, slug, description, price, old_price,
        category_id, weight_grams, servings, tags,
        rating_average, reviews_count, confectioner_id,
        status, is_featured, created_at, images
      `)
      .eq(UUID_RE.test(id) ? "id" : "slug", id)
      .eq("status", "published")
      .maybeSingle();

    if (error) {
      console.error("[products/[id]] GET query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }
    if (!product) {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }

    // Кондитер (split-brain identity: confectioner_id = auth-UUID → confectioners.userId)
    let confectioner: {
      id: string;
      businessName: string;
      avatar: string;
      verified: boolean;
      city: string;
    } | null = null;
    if (product.confectioner_id) {
      const { data: conf } = await supabaseAdmin
        .from("confectioners")
        .select("id, userId, businessName, avatar, verified, city")
        .eq("userId", product.confectioner_id)
        .maybeSingle();
      if (conf) {
        confectioner = {
          id: conf.id,
          businessName: conf.businessName,
          avatar: conf.avatar,
          verified: conf.verified,
          city: conf.city,
        };
      }
    }

    // Фото: products.images (text[]) ∪ product_images (таблица загрузок), с дедупликацией
    const { data: imgData } = await supabaseAdmin
      .from("product_images")
      .select("url")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });
    const colImages = Array.isArray(product.images) ? (product.images as string[]) : [];
    const tableImages = (imgData || []).map((i: { url: string }) => i.url);
    const mergedImages = [...new Set([...colImages, ...tableImages])];

    // Срезы (фото разреза + подпись) — для карточки с fallback
    const { data: slices } = await supabaseAdmin
      .from("product_slices")
      .select("id, fillingName, image, config, caption, sortOrder")
      .eq("productId", product.id)
      .order("sortOrder", { ascending: true });

    // Отзывы (approved) + имена авторов из profiles
    const { data: reviews } = await supabaseAdmin
      .from("product_reviews")
      .select("id, user_id, rating, text, pros, cons, helpful_count, created_at")
      .eq("product_id", product.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(50);

    let enrichedReviews: Array<Record<string, unknown>> = [];
    if (reviews && reviews.length > 0) {
      const userIds = [...new Set(reviews.map((r: { user_id: string }) => r.user_id))];
      const { data: authors } = await supabaseAdmin
        .from("profiles")
        .select("id, name, avatar_url")
        .in("id", userIds);
      const authorMap = new Map((authors || []).map((a: { id: string; name: string; avatar_url: string }) => [a.id, a]));
      enrichedReviews = reviews.map((r: Record<string, unknown>) => {
        const author = authorMap.get(r.user_id as string);
        return {
          id: r.id,
          rating: r.rating,
          text: r.text,
          pros: r.pros,
          cons: r.cons,
          helpfulCount: r.helpful_count,
          createdAt: r.created_at,
          author: author
            ? { id: author.id, name: author.name, avatar: author.avatar_url }
            : null,
        };
      });
    }

    return NextResponse.json({
      product: {
        ...product,
        images: mergedImages,
        confectioner,
      },
      slices: slices || [],
      reviews: enrichedReviews,
    });
  } catch (error: any) {
    console.error("GET /api/products/[id] error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: error?.message },
      { status: 500 }
    );
  }
}
