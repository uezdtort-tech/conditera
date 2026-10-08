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
import {
  parseQueryIntent,
  filterAndRank,
  toSearchDoc,
  wordStem,
  type SearchDoc,
  type AllergenKey,
  type OccasionKey,
  type RankOptions,
} from "@/lib/product-search";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
/** Верхняя граница выборки кандидатов для поискового движка (фасетный каталог) */
const SEARCH_CANDIDATES_CAP = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLERGEN_KEYS: AllergenKey[] = ["nuts", "gluten", "sugar", "lactose", "egg"];
const OCCASION_KEYS: OccasionKey[] = ["birthday", "wedding", "kids", "gift", "holiday"];

function isAllergenKey(v: string): v is AllergenKey {
  return (ALLERGEN_KEYS as string[]).includes(v);
}
function isOccasionKey(v: string): v is OccasionKey {
  return (OCCASION_KEYS as string[]).includes(v);
}
function numParam(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Поля products для выдачи (0052-карточка + dietary_features для фильтров P2). */
const PRODUCT_SELECT = `
  id, title, slug, description, price, old_price,
  category_id, weight_grams, servings, tags,
  rating_average, reviews_count, confectioner_id,
  status, is_featured, created_at, images,
  short_description, long_description,
  diameter_cm, height_cm, size_text, shape, product_type,
  filling_description, layers_count, composition, recipe_id,
  min_order_qty, custom_order_available, is_available, production_time_hours,
  dietary_features
`;

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

/** DB-строка products → SearchDoc поискового движка. */
function rowToDoc(r: Record<string, unknown>): SearchDoc {
  return toSearchDoc({
    id: String(r.id),
    title: String(r.title ?? ""),
    description: (r.description as string | null) ?? null,
    shortDescription: (r.short_description as string | null) ?? null,
    longDescription: (r.long_description as string | null) ?? null,
    fillingDescription: (r.filling_description as string | null) ?? null,
    tags: (r.tags as string[] | null) ?? [],
    dietaryFeatures: (r.dietary_features as string[] | null) ?? [],
    composition:
      (r.composition as { ingredients?: string[]; allergens?: string[] } | null) ?? null,
    price: Number(r.price) || 0,
    servings: (r.servings as number | null) ?? null,
    weightGrams: (r.weight_grams as number | null) ?? null,
    isAvailable: r.is_available !== false,
    rating: Number(r.rating_average ?? 0),
    reviewsCount: Number(r.reviews_count ?? 0),
  });
}

/**
 * GET /api/products — получить список товаров с фильтрами.
 *
 * P2.1: поиск через единый движок (title/описания/начинка/теги с русской
 * морфологией, «до N ₽», «на N человек», «без орехов») + фильтры
 * priceMin/priceMax/servingsMin/occasion/exclude/taste/inStock.
 * Ответ (products/total/limit/offset) не менялся — обратная совместимость.
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

    // ==== P2.1 расширенные фильтры ====
    const priceMin = numParam(searchParams, "priceMin");
    const priceMax = numParam(searchParams, "priceMax");
    const servingsMin = numParam(searchParams, "servingsMin");
    const weightMin = numParam(searchParams, "weightMin");
    const weightMax = numParam(searchParams, "weightMax");
    const occasionRaw = searchParams.get("occasion");
    const occasion =
      occasionRaw && isOccasionKey(occasionRaw) ? occasionRaw : null;
    const excludeKeys = (searchParams.get("exclude") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(isAllergenKey);
    const tasteRaw = searchParams.get("taste");
    const inStock = searchParams.get("inStock") === "true";

    const advanced = Boolean(
      (search && search.trim()) ||
        priceMin !== null ||
        priceMax !== null ||
        servingsMin !== null ||
        weightMin !== null ||
        weightMax !== null ||
        occasion ||
        excludeKeys.length > 0 ||
        (tasteRaw && tasteRaw.trim()) ||
        inStock
    );

    // Категории: одна выборка для резолва slug→id и enrichment category_slug.
    const { data: allCategories, error: catError } = await supabaseAdmin
      .from("product_categories")
      .select("id, slug");
    if (catError) {
      console.error("[products] GET categories error:", catError.message);
      return NextResponse.json(
        { error: "Database query failed", details: catError.message },
        { status: 500 }
      );
    }
    const catSlugById: Record<string, string> = {};
    (allCategories || []).forEach((c: { id: string; slug: string }) => {
      catSlugById[c.id] = c.slug;
    });

    let categoryIds: string[] | null = null;
    if (category && category !== "all") {
      if (UUID_RE.test(category)) {
        categoryIds = [category];
      } else {
        categoryIds = (allCategories || [])
          .filter((c: { slug: string }) => c.slug === category)
          .map((c: { id: string }) => c.id);
        if (categoryIds.length === 0) {
          // Категории с таким slug нет в БД — товаров по ней не может быть
          return NextResponse.json({ products: [], total: 0, limit, offset });
        }
      }
    }

    /** Enrichment страницы: кондитер, изображения, обложка, category_slug. */
    const enrichProducts = async (
      rows: Record<string, unknown>[]
    ): Promise<Record<string, unknown>[]> => {
      const confectionerIds = [
        ...new Set(rows.map((p) => p.confectioner_id as string).filter(Boolean)),
      ];
      const productIds = rows.map((p) => p.id as string);

      const confectionerMap: Record<
        string,
        { id: string; businessName: string; avatar: string; verified: boolean; city: string }
      > = {};
      if (confectionerIds.length > 0) {
        // split-brain identity: products.confectioner_id — auth-UUID,
        // у confectioners он в «userId» (TEXT), а не в «id»
        const { data: confData } = await supabaseAdmin
          .from("confectioners")
          .select("id, userId, businessName, avatar, verified, city")
          .in("userId", confectionerIds);
        (confData || []).forEach((c: { id: string; userId: string; businessName: string; avatar: string; verified: boolean; city: string }) => {
          confectionerMap[c.userId] = c;
        });
      }

      const imageMap: Record<string, string[]> = {};
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

      return rows.map((p) => {
        const confId = p.confectioner_id as string;
        const conf = confId ? confectionerMap[confId] : null;
        const colImages = Array.isArray(p.images) ? (p.images as string[]) : [];
        const tableImages = imageMap[p.id as string] || [];
        const coverUrl = coverMap[p.id as string];
        const mergedImages = [
          ...new Set([...(coverUrl ? [coverUrl] : []), ...colImages, ...tableImages]),
        ];
        const categorySlug = catSlugById[p.category_id as string] ?? null;
        return {
          ...p,
          images: mergedImages,
          category_slug: categorySlug,
          confectioner: conf
            ? {
                id: conf.id,
                businessName: conf.businessName,
                avatar: conf.avatar,
                verified: conf.verified,
                city: conf.city,
              }
            : null,
        };
      });
    };

    if (advanced) {
      // ==== Поисковый движок: кандидаты ≤500 → фильтры/скоринг → страница ====
      let candidatesQuery = supabaseAdmin
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("status", "published");
      if (categoryIds) candidatesQuery = candidatesQuery.in("category_id", categoryIds);
      if (confectionerId) candidatesQuery = candidatesQuery.eq("confectioner_id", confectionerId);
      candidatesQuery = candidatesQuery.range(0, SEARCH_CANDIDATES_CAP - 1);

      const { data: rows, error } = await candidatesQuery;
      if (error) {
        console.error("[products] GET search query error:", error.message);
        return NextResponse.json(
          { error: "Database query failed", details: error.message },
          { status: 500 }
        );
      }

      // Интент из строки запроса + явные параметры (строже из двух).
      const intent = parseQueryIntent(search ?? "");
      if (priceMin !== null) {
        intent.priceMin = intent.priceMin !== null ? Math.max(intent.priceMin, priceMin) : priceMin;
      }
      if (priceMax !== null) {
        intent.priceMax = intent.priceMax !== null ? Math.min(intent.priceMax, priceMax) : priceMax;
      }
      if (servingsMin !== null) {
        intent.servingsMin =
          intent.servingsMin !== null ? Math.max(intent.servingsMin, servingsMin) : servingsMin;
      }
      if (occasion) intent.occasion = occasion;
      for (const key of excludeKeys) {
        if (!intent.excludeAllergens.includes(key)) intent.excludeAllergens.push(key);
      }
      if (tasteRaw) {
        for (const word of tasteRaw.split(",")) {
          const stem = wordStem(word.trim());
          if (stem && !intent.tastes.includes(stem)) intent.tastes.push(stem);
        }
      }

      let docs = (rows || []).map((r: Record<string, unknown>) => rowToDoc(r));
      if (inStock) docs = docs.filter((d) => d.isAvailable);
      // Размер (P2 §4): вес в граммах — фильтр по известным данным
      if (weightMin !== null || weightMax !== null) {
        docs = docs.filter((d) => {
          if (d.weightGrams === null) return true; // вес неизвестен — не выдумываем
          if (weightMin !== null && d.weightGrams < weightMin) return false;
          if (weightMax !== null && d.weightGrams > weightMax) return false;
          return true;
        });
      }

      const rankSort: RankOptions["sort"] =
        sort === "price-asc" || sort === "price-desc" || sort === "rating" ? sort : "popular";
      const ranked = filterAndRank(docs, intent, { sort: rankSort });
      const total = ranked.total;
      const page = ranked.items.slice(offset, offset + limit).map((d) => d.id);
      const pageRows = (rows || []).filter((r: Record<string, unknown>) =>
        page.includes(r.id as string)
      );
      // Восстановить порядок ранжирования
      pageRows.sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          page.indexOf(a.id as string) - page.indexOf(b.id as string)
      );

      const enrichedProducts = await enrichProducts(pageRows);
      return NextResponse.json({ products: enrichedProducts, total, limit, offset });
    }

    // ==== Обычный путь (без q/advanced) — прежние PostgREST-фильтры ====
    let query = supabaseAdmin.from("products").select(PRODUCT_SELECT).eq("status", "published");

    // total — ОБЩЕЕ число товаров с теми же фильтрами (не размер страницы).
    // head:true + count:exact — один COUNT без передачи строк.
    let countQuery = supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("status", "published");
    if (categoryIds) countQuery = countQuery.in("category_id", categoryIds);
    if (confectionerId) countQuery = countQuery.eq("confectioner_id", confectionerId);
    const { count: totalCount, error: countError } = await countQuery;
    if (countError) {
      console.error("[products] GET count error:", countError.message);
      // не роняем выдачу — fallback на размер страницы
    }

    if (confectionerId) {
      query = query.eq("confectioner_id", confectionerId);
    }
    if (categoryIds) {
      query = query.in("category_id", categoryIds);
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

    const enrichedProducts = await enrichProducts((products || []) as Record<string, unknown>[]);

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
