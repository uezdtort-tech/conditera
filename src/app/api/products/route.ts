/**
 * GET  /api/products — список товаров с фильтрами (public)
 * POST /api/products — создать товар (только CONFECTIONER, подтверждённый админом)
 *
 * GET Query параметры:
 *  - category:       slug категории (или "all")
 *  - q:              поиск по title/description (ILIKE)
 *  - confectionerId: фильтр по кондитеру
 *  - sort:           popular | price-asc | price-desc | rating (по умолчанию popular)
 *  - limit:          1-100 (по умолчанию 20)
 *  - offset:         по умолчанию 0
 *
 * POST логика:
 *   1. Проверка аутентификации
 *   2. Проверка роли CONFECTIONER
 *   3. Gate: кондитер должен быть подтверждён (checkConfectionerGate)
 *   4. Найти профиль кондитера (по user_id)
 *   5. Создать товар в products
 *   6. Авто-модерация контента (moderateContent):
 *      - если rejected → удалить товар, вернуть 403 с violations
 *      - если flagged → оставить, но залогировать
 *
 * Соответствует таблицам: products, confectioners, moderation_queue
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

interface CreateProductBody {
  title: string;
  slug?: string;
  description?: string;
  price: number;
  oldPrice?: number;
  category?: string;
  images?: string[];
  weight?: number;
  servings?: number;
  prepTime?: number;
  tags?: string[];
  fillings?: string[];
  coatings?: string[];
  decorations?: string[];
  paymentOptions?: string[];
}

/**
 * GET /api/products — получить список товаров с фильтрами.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const search = searchParams.get("q");
    const confectionerId = searchParams.get("confectionerId");
    const sort = searchParams.get("sort") || "popular";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Fetch products — use correct column names from the actual schema.
    // The products table (migration 0002) has: id, title, slug, description, price,
    // old_price, category_id (not "category"), weight_grams (not "weight"),
    // servings, tags, rating_average (not "rating"), reviews_count, status, is_featured.
    // Images are in a separate product_images table, not a column on products.
    // confectioner_id is UUID FK to auth.users — NOT to confectioners table (TEXT id).
    // We fetch confectioner data separately after getting products.
    let query = supabaseAdmin
      .from("products")
      .select(`
        id, title, slug, description, price, old_price,
        category_id, weight_grams, servings, tags,
        rating_average, reviews_count, confectioner_id,
        status, is_featured, created_at
      `)
      .eq("status", "published");

    // Фильтр по категории (category_id is UUID, but we accept slug too)
    if (category && category !== "all") {
      query = query.eq("category_id", category);
    }

    // Фильтр по кондитеру
    if (confectionerId) {
      query = query.eq("confectioner_id", confectionerId);
    }

    // Поиск по title/description (ILIKE)
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Сортировка
    switch (sort) {
      case "price-asc":
        query = query.order("price", { ascending: true });
        break;
      case "price-desc":
        query = query.order("price", { ascending: false });
        break;
      case "rating":
        query = query.order("rating_average", { ascending: false });
        break;
      case "popular":
      default:
        query = query.order("reviews_count", { ascending: false });
        break;
    }

    // Пагинация
    query = query.range(offset, offset + limit - 1);

    const { data: products, error } = await query;

    if (error) {
      console.error("[products] GET query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    // Fetch confectioner profiles and product images separately
    // (avoiding PostgREST relationship which doesn't exist between products.confectioner_id and confectioners.id)
    const confectionerIds = [...new Set((products || []).map((p: { confectioner_id: string }) => p.confectioner_id).filter(Boolean))];
    const productIds = (products || []).map((p: { id: string }) => p.id);

    // Batch fetch confectioners
    // ВАЖНО (split-brain identity): products.confectioner_id — auth-UUID,
    // у confectioners он лежит в «userId» (TEXT-колонка), а не в «id».
    let confectionerMap: Record<string, { id: string; businessName: string; avatar: string; verified: boolean; city: string }> = {};
    if (confectionerIds.length > 0) {
      const { data: confData } = await supabaseAdmin
        .from("confectioners")
        .select("id, userId, businessName, avatar, verified, city")
        .in("userId", confectionerIds);
      (confData || []).forEach((c: { id: string; userId: string; businessName: string; avatar: string; verified: boolean; city: string }) => {
        confectionerMap[c.userId] = c;
      });
    }

    // Batch fetch product images
    let imageMap: Record<string, string[]> = {};
    if (productIds.length > 0) {
      const { data: imgData } = await supabaseAdmin
        .from("product_images")
        .select("product_id, url")
        .in("product_id", productIds)
        .order("sort_order", { ascending: true });
      (imgData || []).forEach((img: { product_id: string; url: string }) => {
        if (!imageMap[img.product_id]) imageMap[img.product_id] = [];
        imageMap[img.product_id].push(img.url);
      });
    }

    // Merge products with confectioner and images
    const enrichedProducts = (products || []).map((p: Record<string, unknown>) => {
      const confId = p.confectioner_id as string;
      const conf = confId ? confectionerMap[confId] : null;
      return {
        ...p,
        images: imageMap[(p.id as string)] || [],
        confectioner: conf ? {
          id: conf.id,
          businessName: conf.businessName,
          avatar: conf.avatar,
          verified: conf.verified,
          city: conf.city,
        } : null,
      };
    });

    return NextResponse.json({
      products: enrichedProducts,
      total: enrichedProducts.length,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("GET /api/products error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/products — создать товар (только CONFECTIONER, подтверждённый).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — только CONFECTIONER
    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    // Gate: кондитер должен быть подтверждён админом
    const { checkConfectionerGate } = await import("@/lib/confectioner-gate");
    const gate = await checkConfectionerGate(user.id);
    if (!gate.allowed) {
      return NextResponse.json(
        {
          error: gate.reason,
          verificationStatus: gate.status,
          requiresApproval: true,
        },
        { status: 403 }
      );
    }

    const body = (await request.json()) as CreateProductBody;

    // Валидация
    if (!body.title || typeof body.title !== "string" || body.title.length < 3) {
      return NextResponse.json(
        { error: "title обязателен и должен быть не менее 3 символов" },
        { status: 422 }
      );
    }
    if (typeof body.price !== "number" || body.price < 0) {
      return NextResponse.json(
        { error: "price обязателен и должен быть неотрицательным числом" },
        { status: 422 }
      );
    }

    // Найти профиль кондитера
    // ВАЖНО: confectioners — camelCase-схема (миграция 0017): «userId», «businessName».
    // userId = auth-UUID пользователя.
    const { data: confectioner, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id, userId, businessName")
      .eq("userId", user.id)
      .maybeSingle();

    if (confErr || !confectioner) {
      return NextResponse.json(
        { error: "Профиль кондитера не найден" },
        { status: 404 }
      );
    }

    // Генерировать slug если не передан
    const slug = body.slug || body.title.toLowerCase().replace(/\s+/g, "-").slice(0, 100);

    // Резолв категории: body.category — slug из product_categories
    let categoryId: string | null = null;
    if (body.category) {
      const { data: cat } = await supabaseAdmin
        .from("product_categories")
        .select("id")
        .eq("slug", body.category)
        .maybeSingle();
      categoryId = cat?.id ?? null;
    }

    // Создать товар
    // Схема products (миграция 0002): price в КОПЕЙКАХ, category_id (FK),
    // weight_grams, rating_average; images/состав живут в отдельных таблицах.
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .insert({
        title: body.title,
        slug,
        description: body.description || null,
        price: body.price,
        old_price: body.oldPrice || null,
        category_id: categoryId,
        confectioner_id: confectioner.userId,
        weight_grams: body.weight || null,
        servings: body.servings || null,
        tags: body.tags || [],
        status: "published",
        published_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !product) {
      console.error("[products] POST create error:", error?.message);
      return NextResponse.json(
        { error: "Database insert failed", details: error?.message },
        { status: 500 }
      );
    }

    // Авто-модерация контента (non-blocking, но при rejected — удалить товар)
    try {
      const { moderateContent } = await import("@/lib/content-moderation");
      const moderationResult = await moderateContent({
        contentType: "product",
        contentId: product.id,
        authorId: user.id,
        authorName: confectioner.businessName,
        title: product.title,
        content: product.description || "",
        images: body.images || [],
      });

      if (moderationResult.status === "rejected") {
        // Удалить товар — нарушает правила
        await supabaseAdmin.from("products").delete().eq("id", product.id);
        return NextResponse.json(
          {
            error: "Контент отклонён автоматической модерацией",
            violations: moderationResult.violations,
            reasons: moderationResult.reasons,
            moderationId: moderationResult.queueId,
          },
          { status: 403 }
        );
      }

      if (moderationResult.status === "flagged") {
        console.warn(
          `[products] Content flagged: ${product.id}, violations: ${(moderationResult.violations || []).join(", ")}`
        );
      }
    } catch (modErr: any) {
      console.warn("[products] Moderation check failed (non-blocking):", modErr?.message);
    }

    return NextResponse.json({ product }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/products error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: error?.message },
      { status: 500 }
    );
  }
}
