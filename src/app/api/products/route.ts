/**
 * GET  /api/products — список товаров с фильтрами (public)
 * POST /api/products — создать товар (CONFECTIONER — свой; ADMIN/SUPER_ADMIN —
 *                      от имени любого кондитера через body.confectionerId)
 *
 * GET Query параметры:
 *  - category:       slug категории (или "all")
 *  - q:              поиск по title/description (ILIKE)
 *  - confectionerId: фильтр по кондитеру
 *  - sort:           popular | price-asc | price-desc | rating (по умолчанию popular)
 *  - limit:          1-100 (по умолчанию 20)
 *  - offset:         по умолчанию 0
 *
 * GET enrichment (Task 3-a): обложки product_media (approved, is_cover, photo)
 *   добавляются В НАЧАЛО images как /api/product-media/<id> (dedupe).
 *
 * POST логика:
 *   1. Проверка аутентификации
 *   2. Роль: ADMIN/SUPER_ADMIN → adminCreateProductSchema (confectionerId обязателен,
 *      проверка существования пользователя в auth.users); CONFECTIONER → легаси-ветка
 *      (свой id, gate подтверждения); остальные → 403
 *   3. Создать товар в products (новые поля карточки 0052 мапятся в snake_case)
 *   4. Авто-модерация контента (moderateContent):
 *      - если rejected → удалить товар, вернуть 403 с violations
 *      - если flagged → оставить, но залогировать
 *
 * Соответствует таблицам: products, confectioners, moderation_queue, product_media
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPool } from "@/lib/postgrest/pool";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole, isAdmin } from "@/lib/role-guards";
import {
  adminCreateProductSchema,
  confectionerCreateProductSchema,
} from "@/lib/validations/product";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Поисковая строка → безопасный ILIKE-паттерн для PostgREST or().
 *
 * or() парсит значение по разделителям `,` `(` `)` `"` — ввод пользователя с
 * такими символами («торт,тест») ломал синтаксис и давал 400. Спецсимволы
 * заменяются на пробел, пробелы внутри — на `%` (мягкое AND: "торт тест"
 * → %торт%тест%). Возвращаемый паттерн гарантированно не содержит
 * разделителей or() и не может сломать запрос.
 */
function toSafeIlikePattern(raw: string): string | null {
  const cleaned = raw.replace(/[(),"\\]/g, " ").trim();
  if (!cleaned) return null;
  return `%${cleaned.replace(/\s+/g, "%")}%`;
}

/** camel→snake маппинг полей карточки 0052 для INSERT (только переданные поля). */
function mapCardFieldsToSnake(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: Array<[string, string]> = [
    ["shortDescription", "short_description"],
    ["longDescription", "long_description"],
    ["oldPrice", "old_price"],
    ["categoryId", "category_id"],
    ["weightGrams", "weight_grams"],
    ["diameterCm", "diameter_cm"],
    ["heightCm", "height_cm"],
    ["sizeText", "size_text"],
    ["shape", "shape"],
    ["productType", "product_type"],
    ["fillingDescription", "filling_description"],
    ["layersCount", "layers_count"],
    ["recipeId", "recipe_id"],
    ["minOrderQty", "min_order_qty"],
    ["customOrderAvailable", "custom_order_available"],
    ["isAvailable", "is_available"],
    ["productionTimeHours", "production_time_hours"],
  ];
  for (const [camel, snake] of map) {
    if (v[camel] !== undefined) out[snake] = v[camel];
  }
  if (v.composition !== undefined) out.composition = v.composition ?? {};
  if (v.tags !== undefined) out.tags = v.tags;
  return out;
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
        status, is_featured, created_at, images,
        short_description, long_description,
        diameter_cm, height_cm, size_text, shape, product_type,
        filling_description, layers_count, composition, recipe_id,
        min_order_qty, custom_order_available, is_available, production_time_hours
      `)
      .eq("status", "published");

    // Фильтр по категории: products.category_id — UUID FK на product_categories.id,
    // витрина шлёт slug («cakes») → резолвим slug в id. Если передали UUID —
    // используем напрямую. Неизвестный slug → честная пустая выдача (товаров
    // такой категории не существует), а не отсутствие фильтра.
    let categoryIds: string[] | null = null;
    if (category && category !== "all") {
      if (UUID_RE.test(category)) {
        categoryIds = [category];
      } else {
        const { data: catRows, error: catError } = await supabaseAdmin
          .from("product_categories")
          .select("id")
          .eq("slug", category);
        if (catError) {
          console.error("[products] GET categories lookup error:", catError.message);
          return NextResponse.json(
            { error: "Database query failed", details: catError.message },
            { status: 500 }
          );
        }
        categoryIds = (catRows || []).map((c: { id: string }) => c.id);
        if (categoryIds.length === 0) {
          // Категории с таким slug нет в БД — товаров по ней не может быть
          return NextResponse.json({ products: [], total: 0, limit, offset });
        }
      }
    }

    // Поиск по title/description (ILIKE): паттерн уже безопасен для or()
    const searchPattern = search ? toSafeIlikePattern(search) : null;

    // total — ОБЩЕЕ число товаров с теми же фильтрами (не размер страницы).
    // head:true + count:exact — один COUNT без передачи строк.
    let countQuery = supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("status", "published");
    if (categoryIds) countQuery = countQuery.in("category_id", categoryIds);
    if (confectionerId) countQuery = countQuery.eq("confectioner_id", confectionerId);
    if (searchPattern) {
      countQuery = countQuery.or(
        `title.ilike.${searchPattern},description.ilike.${searchPattern}`
      );
    }
    const { count: totalCount, error: countError } = await countQuery;
    if (countError) {
      console.error("[products] GET count error:", countError.message);
      // не роняем выдачу — fallback на размер страницы
    }

    // Фильтр по кондитеру
    if (confectionerId) {
      query = query.eq("confectioner_id", confectionerId);
    }
    if (categoryIds) {
      query = query.in("category_id", categoryIds);
    }
    if (searchPattern) {
      query = query.or(
        `title.ilike.${searchPattern},description.ilike.${searchPattern}`
      );
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

    // Обложки product_media (Task 3-a): approved + is_cover + photo,
    // одним запросом по всем товарам выборки. URL /api/product-media/<id>
    // добавляется В НАЧАЛО images (dedupe).
    const coverMap: Record<string, string> = {};
    if (productIds.length > 0) {
      const { data: coverData } = await supabaseAdmin
        .from("product_media")
        .select("id, product_id")
        .in("product_id", productIds)
        .eq("status", "approved")
        .eq("is_cover", true)
        .eq("media_type", "photo");
      (coverData || []).forEach((c: { id: string; product_id: string }) => {
        coverMap[c.product_id] = `/api/product-media/${c.id}`;
      });
    }

    // Merge products with confectioner and images.
    // Источник фото: product_media обложка (В НАЧАЛЕ) + products.images (text[],
    // сид 0005) + product_images (отдельная таблица загрузок) — с дедупликацией.
    const enrichedProducts = (products || []).map((p: Record<string, unknown>) => {
      const confId = p.confectioner_id as string;
      const conf = confId ? confectionerMap[confId] : null;
      const colImages = Array.isArray(p.images) ? (p.images as string[]) : [];
      const tableImages = imageMap[(p.id as string)] || [];
      const coverUrl = coverMap[p.id as string];
      const mergedImages = [
        ...new Set([...(coverUrl ? [coverUrl] : []), ...colImages, ...tableImages]),
      ];
      return {
        ...p,
        images: mergedImages,
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
      total: countError ? enrichedProducts.length : (totalCount ?? 0),
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
 * POST /api/products — создать товар.
 * ADMIN/SUPER_ADMIN: body.confectionerId (camel) обязателен (422 без него),
 *   пользователь должен существовать в auth.users (иначе 422 UNKNOWN_CONFECTIONER).
 * CONFECTIONER: как раньше (свой id, gate подтверждения).
 * Остальные роли: 403.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }
    const body = (rawBody ?? {}) as Record<string, unknown>;

    const admin = await isAdmin(user.id);

    // ==================== Ветка ADMIN/SUPER_ADMIN ====================
    if (admin) {
      const parsed = adminCreateProductSchema.safeParse(body);
      if (!parsed.success) {
        // confectionerId без него → 422 (zod: Invalid input … required)
        return NextResponse.json(
          { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
          { status: 422 }
        );
      }
      const input = parsed.data;

      // Целевой кондитер должен существовать в auth.users
      const pool = getPool();
      const exists = await pool.query(
        "SELECT 1 FROM auth.users WHERE id = $1 LIMIT 1",
        [input.confectionerId]
      );
      if (exists.rows.length === 0) {
        return NextResponse.json(
          { error: "UNKNOWN_CONFECTIONER", message: "Пользователь confectionerId не найден" },
          { status: 422 }
        );
      }

      // Имя автора для авто-модерации — профиль целевого кондитера (fallback: админ)
      const authorNameRes = await pool.query(
        "SELECT coalesce(name, email, 'Кондитер') AS name FROM public.profiles WHERE id = $1",
        [input.confectionerId]
      );
      const authorName: string = String(
        authorNameRes.rows[0]?.name || user.email || "Админ"
      );

      const slug =
        (typeof body.slug === "string" && body.slug) ||
        input.title.toLowerCase().replace(/\s+/g, "-").slice(0, 100);

      // Резолв категории: categoryId (uuid) ИЛИ category (slug, легаси)
      let categoryId: string | null = null;
      if (input.categoryId) {
        categoryId = input.categoryId;
      } else if (typeof body.category === "string" && body.category) {
        const { data: cat } = await supabaseAdmin
          .from("product_categories")
          .select("id")
          .eq("slug", body.category)
          .maybeSingle();
        categoryId = cat?.id ?? null;
      }

      // Статус: draft → без публикации; published (по умолчанию) → валидация контента
      const status = input.status ?? "published";
      if (status === "published") {
        const missing: string[] = [];
        if (input.title.trim().length < 3) missing.push("title");
        if ((input.description ?? "").trim().length < 10) missing.push("description");
        if (typeof input.price !== "number" || input.price < 1) missing.push("price");
        if (missing.length > 0) {
          return NextResponse.json(
            { error: "PUBLISH_VALIDATION_FAILED", missing },
            { status: 422 }
          );
        }
      }

      const insertPayload: Record<string, unknown> = {
        title: input.title,
        slug,
        description: input.description || null,
        price: input.price,
        category_id: categoryId,
        confectioner_id: input.confectionerId,
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
        ...mapCardFieldsToSnake(input as unknown as Record<string, unknown>),
      };
      // old_price: null если не передан (карточный маппинг кладёт значение только
      // при наличии oldPrice в body)
      insertPayload.old_price = input.oldPrice !== undefined ? input.oldPrice : null;
      // category_id: резолв выше (categoryId uuid ИЛИ category slug) приоритетнее
      // карточного маппинга (который может принести явный null из body.categoryId)
      insertPayload.category_id = categoryId;

      const { data: product, error } = await supabaseAdmin
        .from("products")
        .insert(insertPayload)
        .select()
        .single();

      if (error || !product) {
        console.error("[products] POST admin create error:", error?.message);
        return NextResponse.json(
          { error: "Database insert failed", details: error?.message },
          { status: 500 }
        );
      }

      // Авто-модерация контента (не отключаем ни для одной роли)
      const moderation = await runModeration({
        product,
        authorId: input.confectionerId,
        authorName,
        images: (body.images as string[] | undefined) || [],
      });
      if (moderation) return moderation;

      return NextResponse.json({ product }, { status: 201 });
    }

    // ==================== Ветка CONFECTIONER (легаси) ====================
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

    // Валидация НОВЫХ полей карточки (title/price — легаси-ручные проверки ниже)
    const cardParsed = confectionerCreateProductSchema.safeParse(body);
    if (!cardParsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", issues: cardParsed.error.flatten() },
        { status: 422 }
      );
    }

    // Легаси-валидация (обратная совместимость контракта)
    const title = body.title;
    const price = body.price;
    if (!title || typeof title !== "string" || title.length < 3) {
      return NextResponse.json(
        { error: "title обязателен и должен быть не менее 3 символов" },
        { status: 422 }
      );
    }
    if (typeof price !== "number" || price < 0) {
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
    const legacySlug =
      (typeof body.slug === "string" && body.slug) ||
      title.toLowerCase().replace(/\s+/g, "-").slice(0, 100);

    // Резолв категории: body.category — slug из product_categories (легаси);
    // body.categoryId (uuid) — новое поле карточки, тоже принимаем
    let categoryId: string | null = null;
    if (typeof body.categoryId === "string" && UUID_RE.test(body.categoryId)) {
      categoryId = body.categoryId;
    } else if (typeof body.category === "string" && body.category) {
      const { data: cat } = await supabaseAdmin
        .from("product_categories")
        .select("id")
        .eq("slug", body.category)
        .maybeSingle();
      categoryId = cat?.id ?? null;
    }

    // Создать товар
    // Схема products (миграция 0002): price в РУБЛЯХ, category_id (FK),
    // weight_grams, rating_average; + новые поля карточки 0052.
    // Легаси-ключи идут ПОСЛЕ spread карточных — их приоритет сохранён.
    const cardSnake = mapCardFieldsToSnake(
      cardParsed.data as unknown as Record<string, unknown>
    );
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .insert({
        ...cardSnake,
        title,
        slug: legacySlug,
        description:
          typeof body.description === "string" && body.description
            ? body.description
            : null,
        price,
        old_price: typeof body.oldPrice === "number" ? body.oldPrice : null,
        category_id: categoryId,
        confectioner_id: confectioner.userId,
        weight_grams:
          typeof body.weight === "number"
            ? body.weight
            : typeof body.weightGrams === "number"
              ? body.weightGrams
              : null,
        servings: typeof body.servings === "number" ? body.servings : null,
        tags: Array.isArray(body.tags) ? body.tags : [],
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
    const moderation = await runModeration({
      product,
      authorId: user.id,
      authorName: confectioner.businessName,
      images: (body.images as string[] | undefined) || [],
    });
    if (moderation) return moderation;

    return NextResponse.json({ product }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/products error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * Авто-модерация контента (общая для обеих веток POST).
 * При rejected — удалить товар и вернуть 403-ответ; при flagged — warn в лог.
 * Возвращает NextResponse | null (null — продолжаем).
 */
async function runModeration(args: {
  product: { id: string; title: string; description: string | null };
  authorId: string;
  authorName: string;
  images: string[];
}): Promise<NextResponse | null> {
  try {
    const { moderateContent } = await import("@/lib/content-moderation");
    const moderationResult = await moderateContent({
      contentType: "product",
      contentId: args.product.id,
      authorId: args.authorId,
      authorName: args.authorName,
      title: args.product.title,
      content: args.product.description || "",
      images: args.images,
    });

    if (moderationResult.status === "rejected") {
      // Удалить товар — нарушает правила
      await supabaseAdmin.from("products").delete().eq("id", args.product.id);
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
        `[products] Content flagged: ${args.product.id}, violations: ${(moderationResult.violations || []).join(", ")}`
      );
    }
  } catch (modErr: any) {
    console.warn("[products] Moderation check failed (non-blocking):", modErr?.message);
  }
  return null;
}
