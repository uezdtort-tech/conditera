/**
 * GET   /api/products/[id] — карточка товара (public).
 * PATCH /api/products/[id] — обновление карточки (owner кондитер ИЛИ ADMIN/SUPER_ADMIN).
 *
 * GET: резолв UUID или slug. Enrichment:
 *   - confectioner (products.confectioner_id = auth-UUID → confectioners.userId)
 *   - images: approved-фото product_media (URL /api/product-media/<id>, В НАЧАЛЕ,
 *     dedupe) ∪ products.images (text[], сид 0005) ∪ product_images (загрузки)
 *   - media: approved product_media (фото+видео, is_cover DESC, sort_order ASC)
 *   - slices: product_slices (фото разреза, fallback для карточки)
 *   - reviews: product_reviews (status='approved') + имена из profiles
 *   - новые колонки карточки 0052 (short_description, размеры, composition, ...)
 *
 * PATCH (миграция 0052, Task 3-a):
 *   - auth: product.confectioner_id === user.id ИЛИ ADMIN/SUPER_ADMIN (иначе 401/403)
 *   - валидация updateProductSchema (zod): 422 VALIDATION_FAILED { issues }
 *   - status 'blocked' — только ADMIN/SUPER_ADMIN (403 STATUS_NOT_ALLOWED для остальных)
 *   - переход в 'published': проверка объединённой строки (текущая + патч):
 *     title ≥3, description ≥10, price ≥1 → иначе 422 PUBLISH_VALIDATION_FAILED
 *     { missing }; media не обязательны (0..10 фото по ТЗ);
 *     published_at = now() только если был null
 *   - 'draft'/'archived' — свободно (owner+admin)
 *   - deleted_at IS NULL иначе 404; товар не существует → 404
 *   - updated_at = now(); ответ: полная обновлённая строка { product }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import {
  updateProductSchema,
  adminUpdateProductSchema,
  type UpdateProductInput,
} from "@/lib/validations/product";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Колонки карточки товара (0002 + ALTER 0040/0043 + 0052), snake_case контракт
const PRODUCT_CARD_COLUMNS = `
  id, title, slug, description, short_description, long_description,
  price, old_price, category_id, weight_grams, servings, tags,
  diameter_cm, height_cm, size_text, shape, product_type,
  filling_description, layers_count, composition, recipe_id,
  min_order_qty, custom_order_available, is_available, production_time_hours,
  rating_average, reviews_count, confectioner_id,
  status, is_featured, created_at, updated_at, published_at, images
`;

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
      .select(PRODUCT_CARD_COLUMNS)
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

    // Медиа: approved product_media (фото+видео). Обложка первая, затем sort_order.
    const { data: mediaRows } = await supabaseAdmin
      .from("product_media")
      .select(
        "id, media_type, mime_type, width, height, duration_seconds, is_cover, sort_order, status"
      )
      .eq("product_id", product.id)
      .eq("status", "approved")
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true });

    const media = (mediaRows || []).map(
      (m: {
        id: string;
        media_type: string;
        mime_type: string;
        width: number | null;
        height: number | null;
        duration_seconds: number | null;
        is_cover: boolean;
        sort_order: number;
        status: string;
      }) => ({
        id: m.id,
        mediaType: m.media_type as "photo" | "video",
        url: `/api/product-media/${m.id}`,
        mimeType: m.mime_type,
        width: m.width,
        height: m.height,
        durationSeconds: m.duration_seconds,
        isCover: m.is_cover,
        sortOrder: m.sort_order,
        status: m.status as "approved",
      })
    );

    // Фото: approved-фото product_media (URL-адреса, В НАЧАЛЕ) ∪ products.images (text[])
    // ∪ product_images (таблица загрузок), с дедупликацией
    const { data: imgData } = await supabaseAdmin
      .from("product_images")
      .select("url")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });
    const colImages = Array.isArray(product.images) ? (product.images as string[]) : [];
    const tableImages = (imgData || []).map((i: { url: string }) => i.url);
    const mediaPhotoUrls = media
      .filter((m) => m.mediaType === "photo")
      .map((m) => m.url);
    const mergedImages = [...new Set([...mediaPhotoUrls, ...colImages, ...tableImages])];

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
        media,
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

// ====================================================================
// PATCH /api/products/[id]
// ====================================================================

/** camel→snake маппинг полей карточки; undefined — поле не трогаем, null — очистить. */
function mapCardFieldsToSnake(v: Partial<UpdateProductInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (v.title !== undefined) out.title = v.title;
  if (v.shortDescription !== undefined) out.short_description = v.shortDescription;
  if (v.description !== undefined) out.description = v.description;
  if (v.longDescription !== undefined) out.long_description = v.longDescription;
  if (v.price !== undefined) out.price = v.price;
  if (v.oldPrice !== undefined) out.old_price = v.oldPrice;
  if (v.categoryId !== undefined) out.category_id = v.categoryId;
  if (v.weightGrams !== undefined) out.weight_grams = v.weightGrams;
  if (v.servings !== undefined) out.servings = v.servings;
  if (v.diameterCm !== undefined) out.diameter_cm = v.diameterCm;
  if (v.heightCm !== undefined) out.height_cm = v.heightCm;
  if (v.sizeText !== undefined) out.size_text = v.sizeText;
  if (v.shape !== undefined) out.shape = v.shape;
  if (v.productType !== undefined) out.product_type = v.productType;
  if (v.fillingDescription !== undefined) out.filling_description = v.fillingDescription;
  if (v.layersCount !== undefined) out.layers_count = v.layersCount;
  if (v.composition !== undefined) out.composition = v.composition ?? {};
  if (v.recipeId !== undefined) out.recipe_id = v.recipeId;
  if (v.minOrderQty !== undefined) out.min_order_qty = v.minOrderQty;
  if (v.customOrderAvailable !== undefined) out.custom_order_available = v.customOrderAvailable;
  if (v.isAvailable !== undefined) out.is_available = v.isAvailable;
  if (v.productionTimeHours !== undefined) out.production_time_hours = v.productionTimeHours;
  if (v.tags !== undefined) out.tags = v.tags;
  return out;
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    // 1. Auth
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || id.length > 200) {
      return NextResponse.json({ error: "Некорректный идентификатор товара" }, { status: 400 });
    }

    // 2. Товар существует и не удалён (soft-delete)
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .select("id, confectioner_id, status, published_at, title, description, price, deleted_at")
      .eq(UUID_RE.test(id) ? "id" : "slug", id)
      .maybeSingle();

    if (error) {
      console.error("[products/[id]] PATCH load error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }
    if (!product || product.deleted_at) {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    }

    // 3. Права: владелец товара ИЛИ ADMIN/SUPER_ADMIN
    const admin = await isAdmin(user.id);
    const isOwner = product.confectioner_id === user.id;
    if (!isOwner && !admin) {
      return NextResponse.json(
        { error: "Доступ запрещён: только владелец товара или администратор" },
        { status: 403 }
      );
    }

    // 4. Body + zod-валидация
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    // 'blocked' через общий PATCH запрещён: не-админ получает 403 STATUS_NOT_ALLOWED
    // до валидации схемы; админ проходит через adminUpdateProductSchema.
    const rawStatus = (rawBody as { status?: unknown } | null)?.status;
    if (rawStatus === "blocked" && !admin) {
      return NextResponse.json(
        { error: "STATUS_NOT_ALLOWED", message: "Статус 'blocked' доступен только администратору" },
        { status: 403 }
      );
    }

    const schema = admin ? adminUpdateProductSchema : updateProductSchema;
    const parsed = schema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const patchInput = parsed.data as UpdateProductInput;

    // 5. Переход в 'published': валидация ОБЪЕДИНЁННОЙ строки (текущая + патч).
    //    media НЕ обязательны (0..10 фото по ТЗ).
    const nextStatus = patchInput.status;
    const patch: Record<string, unknown> = mapCardFieldsToSnake(patchInput);

    if (nextStatus === "published") {
      const mergedTitle = (patchInput.title ?? product.title ?? "") as string;
      const mergedDescription = (patchInput.description ?? product.description ?? "") as string;
      const mergedPrice = (patchInput.price ?? product.price ?? 0) as number;
      const missing: string[] = [];
      if (typeof mergedTitle !== "string" || mergedTitle.trim().length < 3) missing.push("title");
      if (typeof mergedDescription !== "string" || mergedDescription.trim().length < 10) missing.push("description");
      if (typeof mergedPrice !== "number" || mergedPrice < 1) missing.push("price");
      if (missing.length > 0) {
        return NextResponse.json(
          { error: "PUBLISH_VALIDATION_FAILED", missing },
          { status: 422 }
        );
      }
      patch.status = "published";
      // published_at = now() только если был null (повторная публикация не сбрасывает дату)
      if (!product.published_at) {
        patch.published_at = new Date().toISOString();
      }
    } else if (nextStatus) {
      // draft/archived (и blocked для админа) — свободно для owner+admin
      patch.status = nextStatus;
    }

    // 6. Нет ни одного изменяемого поля → вернуть текущее состояние без UPDATE
    if (Object.keys(patch).length === 0) {
      const { data: current } = await supabaseAdmin
        .from("products")
        .select(PRODUCT_CARD_COLUMNS)
        .eq("id", product.id)
        .maybeSingle();
      return NextResponse.json({ product: current ?? product, updated: false });
    }

    patch.updated_at = new Date().toISOString();

    // 7. Обновление + полная строка в ответе
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("products")
      .update(patch)
      .eq("id", product.id)
      .select(PRODUCT_CARD_COLUMNS)
      .single();

    if (updErr || !updated) {
      console.error("[products/[id]] PATCH update error:", updErr?.message);
      return NextResponse.json(
        { error: "Database update failed", details: updErr?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ product: updated, updated: true });
  } catch (error: any) {
    console.error("PATCH /api/products/[id] error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: error?.message },
      { status: 500 }
    );
  }
}