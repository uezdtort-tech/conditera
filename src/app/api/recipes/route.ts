/**
 * POST /api/recipes — создать черновик рецепта (RECIPE-02, RB.14).
 *
 * Роли: authenticated (CUSTOMER / RECIPE_DEVELOPER / CONFECTIONER / ADMIN /
 * SUPER_ADMIN). HOME_/BUSINESS_CONFECTIONER — это атрибут business_scale
 * роли CONFECTIONER (миграция 0055), отдельной роли в enum user_role нет.
 * SUPPLIER — запрещено (403, матрица RA: «Создавать личные черновики»).
 *
 * Контракт (RB.14, строка /api/recipes):
 *   • status='draft' и author_id проставляются ТОЛЬКО сервером;
 *   • slug = generateSlug(title) с проверкой уникальности в recipes
 *     (конфликт → 409 «измените title»);
 *   • цены/стоимости от клиента ЗАПРЕЩЕНЫ: поля price/cost/базовая цена
 *     не входят в zod-схему → zod.strip() молча отбрасывает их
 *     (цена живёт ТОЛЬКО в оффере recipe_marketplace, ПР-1);
 *   • source из тела пишется в recipe_sources с rights_confirmed=false
 *     (RA.13: импорт без подтверждённых прав не публикуется — гейт на publish);
 *   • атомарность: сначала INSERT recipes, затем дети; при ошибке детей —
 *     удаление корня и 500 (без частичного состояния; транзакций PostgREST
 *     нет — компенсирующий откат, паттерн marketplace/route.ts);
 *   • валидационные ошибки состава отсекаются ДО вставки корня (422).
 *
 * Ответ: 201 {data: {id, slug, status}}.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { getUserRoles } from "@/lib/role-guards";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";
import { handleRouteError, safeJsonBody } from "@/lib/http-helpers";
import {
  generateSlug,
  normalizePositions,
  stepRowsFromDto,
  ingredientRowsFromDto,
  substituteRowsFromDto,
  variantRowsFromDto,
  sourceRowsFromDto,
  type SourceDto,
} from "@/lib/recipes/recipe-content";

export const runtime = "nodejs";

// ---------- Zod-схемы DTO ----------
// Единицы — канон г/мл/шт (RECIPE-01A §F.3: «ложка/стакан» — display-only, Q-2)
const UNIT = ["г", "мл", "шт"] as const;
const ALLERGENS = [
  "milk", "eggs", "gluten", "nuts", "peanuts", "soy", "fish", "shellfish", "sesame",
] as const; // словарь аллергенов — комментарий колонки recipes.allergens (0065)

const substituteSchema = z.object({
  name: z.string().min(1).max(200),
  qty: z.number().positive().nullable().optional(), // NULL = «по вкусу» (0067)
  unit: z.enum(UNIT).optional(),
  position: z.number().int().min(1).optional(),
});

const ingredientSchema = z.object({
  name: z.string().min(1).max(200),
  qty: z.number().positive().nullable().optional(),
  unit: z.enum(UNIT),
  display_qty: z.string().max(100).optional(),
  is_optional: z.boolean().optional(),
  prep_note: z.string().max(300).optional(),
  group_title: z.string().max(100).optional(),
  position: z.number().int().min(1).optional(),
  substitutes: z.array(substituteSchema).max(10).optional(),
});

const stepSchema = z.object({
  position: z.number().int().min(1).optional(),
  title: z.string().max(200).optional(),
  description: z.string().min(1).max(5000), // NOT NULL в схеме (0066)
  time_min: z.number().int().min(0).max(1440).optional(),
  time_max: z.number().int().min(0).max(1440).optional(),
  temperature_c: z.number().int().min(-50).max(400).optional(),
  tips: z.string().max(2000).optional(),
});

const variantSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  is_default: z.boolean().optional(),
  overrides: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
  servings: z.number().int().min(1).max(500).optional(),
});

const sourceSchema = z.object({
  source_type: z.enum(["telegram", "vk", "site", "document", "manual"]),
  source_url: z.string().max(2048).nullable().optional(),
  source_author: z.string().max(200).nullable().optional(),
  source_published_at: z.string().max(40).nullable().optional(),
  import_method: z.enum(["ai", "manual"]).optional(),
  raw_payload: z.unknown().optional(), // аудит-носитель; в состав не попадает
});

const createSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(1).max(5000),
  subtitle: z.string().max(300).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  prep_time_minutes: z.number().int().min(0).max(10080).optional(),
  cook_time_minutes: z.number().int().min(0).max(10080).optional(),
  servings: z.number().int().min(1).max(500).optional(),
  calories_per_serving: z.number().int().min(0).max(10000).optional(),
  protein_g: z.number().min(0).max(500).optional(),
  fat_g: z.number().min(0).max(500).optional(),
  carb_g: z.number().min(0).max(500).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  category: z.string().max(100).optional(),
  equipment: z.array(z.string().min(1).max(100)).max(30).optional(),
  allergens: z.array(z.enum(ALLERGENS)).max(15).optional(),
  yield_text: z.string().max(200).optional(),
  storage_note: z.string().max(500).optional(),
  ingredients: z.array(ingredientSchema).max(100).optional(),
  steps: z.array(stepSchema).max(100).optional(),
  variants: z.array(variantSchema).max(20).optional(),
  source: sourceSchema.optional(),
  // ВНЕ СХЕМЫ (и потому игнорируется): price/cost/base_price/premium_price/
  // royalty_rate/is_published/status/author_id/slug/id/created_at —
  // решение всех этих полей — исключительно сервер (RB.14).
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Rate-limit мутаций по IP (каденция создания контента = пресет orders)
    const ip = getClientIP(request);
    const blocked = await enforceRateLimit(
      request,
      `recipes-create:${ip}`,
      RATE_LIMITS.orders.limit,
      RATE_LIMITS.orders.windowMs
    );
    if (blocked) return blocked as unknown as NextResponse;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    // Роль — ТОЛЬКО серверно из user_roles (не из JWT-клиента)
    const roles = await getUserRoles(user.userId);
    if (roles.includes("SUPPLIER")) {
      return NextResponse.json(
        { error: "Роль SUPPLIER не может создавать рецепты" },
        { status: 403 }
      );
    }
    const allowed = new Set(["CUSTOMER", "RECIPE_DEVELOPER", "CONFECTIONER", "ADMIN", "SUPER_ADMIN"]);
    if (!roles.some((r) => allowed.has(r))) {
      return NextResponse.json(
        {
          error: "Роль не позволяет создавать рецепты",
          required_roles: ["CUSTOMER", "RECIPE_DEVELOPER", "CONFECTIONER", "ADMIN"],
        },
        { status: 403 }
      );
    }

    const { data: body, error: parseErr } = await safeJsonBody(request);
    if (parseErr) {
      return NextResponse.json({ error: parseErr }, { status: 400 });
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Валидация тела запроса не пройдена",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 422 }
      );
    }
    const dto = parsed.data;

    // Дети строим ДО вставки корня: ошибки валидации состава (позиции)
    // отсекаются 422 без частичного состояния в БД
    const stepsBuild = stepRowsFromDto("", dto.steps ?? []);
    if (stepsBuild.error) return NextResponse.json({ error: `steps: ${stepsBuild.error}` }, { status: 422 });
    const ingredientsBuild = ingredientRowsFromDto("", dto.ingredients ?? []);
    if (ingredientsBuild.error) {
      return NextResponse.json({ error: `ingredients: ${ingredientsBuild.error}` }, { status: 422 });
    }
    // Замены валидируем против НОРМАЛИЗОВАННОГО списка ингредиентов:
    // позиции замен должны быть валидны ДО вставки корня (422 без частичного состояния)
    for (const ing of ingredientsBuild.normalized) {
      if (!ing.substitutes?.length) continue;
      const subNorm = normalizePositions(ing.substitutes);
      if (subNorm.error) {
        return NextResponse.json(
          { error: `ingredients.substitutes: ${subNorm.error}` },
          { status: 422 }
        );
      }
    }
    const variantsBuild = variantRowsFromDto("", dto.variants ?? []);
    if (variantsBuild.error) {
      return NextResponse.json({ error: `variants: ${variantsBuild.error}` }, { status: 422 });
    }
    const sourceBuild = sourceRowsFromDto("", dto.source ? [dto.source as SourceDto] : []);
    if (sourceBuild.error) {
      return NextResponse.json({ error: `source: ${sourceBuild.error}` }, { status: 422 });
    }

    // Slug серверно + проверка уникальности (конфликт → 409 «измените title»)
    const slug = generateSlug(dto.title);
    const { data: slugTaken, error: slugErr } = await supabaseAdmin
      .from("recipes")
      .select("id")
      .eq("slug", slug)
      .limit(1);
    if (slugErr) {
      console.error("[recipes] slug check failed:", slugErr.message);
      return NextResponse.json({ error: "Ошибка при создании рецепта" }, { status: 500 });
    }
    if (slugTaken && slugTaken.length > 0) {
      return NextResponse.json(
        { error: "Рецепт с похожим названием уже существует — измените title" },
        { status: 409 }
      );
    }

    // 1) INSERT корня. author_id/status/created_at — только сервер; цены нет.
    const { data: root, error: rootErr } = await supabaseAdmin
      .from("recipes")
      .insert({
        author_id: user.userId,
        title: dto.title.trim(),
        description: dto.description.trim(),
        subtitle: dto.subtitle?.trim() || null,
        content: "", // MDX-тела нет — состав живёт в детях (модель 0066/0069)
        difficulty: dto.difficulty,
        prep_time_minutes: dto.prep_time_minutes ?? null,
        cook_time_minutes: dto.cook_time_minutes ?? null,
        servings: dto.servings, // absent → DB DEFAULT 8 (канон нормы на порцию)
        calories_per_serving: dto.calories_per_serving ?? null,
        protein_g: dto.protein_g ?? null,
        fat_g: dto.fat_g ?? null,
        carb_g: dto.carb_g ?? null,
        tags: dto.tags ?? [],
        category: dto.category?.trim() || null,
        equipment: dto.equipment ?? [],
        allergens: dto.allergens ?? [],
        yield_text: dto.yield_text?.trim() || null,
        storage_note: dto.storage_note?.trim() || null,
        slug,
        status: "draft", // серверно; клиентский status игнорируется
      })
      .select("id, slug, status")
      .single();

    if (rootErr || !root) {
      // 23505 = UNIQUE recipes.slug (гонка между check и insert)
      const isSlugConflict = (rootErr as { code?: string } | null)?.code === "23505";
      console.error("[recipes] root insert failed:", rootErr?.message);
      return NextResponse.json(
        {
          error: isSlugConflict
            ? "Рецепт с похожим названием уже существует — измените title"
            : "Ошибка при создании рецепта",
          details: rootErr?.message,
        },
        { status: isSlugConflict ? 409 : 500 }
      );
    }

    const recipeId = String(root.id);

    // 2) Дети. При любой ошибке — компенсирующий откат корня и 500.
    const rollbackRoot = async (): Promise<void> => {
      await supabaseAdmin.from("recipes").delete().eq("id", recipeId);
    };

    // 2a. Шаги
    const stepRows = stepRowsFromDto(recipeId, dto.steps ?? []).rows;
    if (stepRows.length > 0) {
      const { error: stepsErr } = await supabaseAdmin.from("recipe_steps").insert(stepRows);
      if (stepsErr) {
        console.error("[recipes] steps insert failed:", stepsErr.message);
        await rollbackRoot();
        return NextResponse.json(
          { error: "Ошибка при сохранении состава (шаги)", details: stepsErr.message },
          { status: 500 }
        );
      }
    }

    // 2b. Ингредиенты (+ substitutes по position свежевставленных строк)
    const ingredientRows = ingredientRowsFromDto(recipeId, dto.ingredients ?? []).rows;
    if (ingredientRows.length > 0) {
      const { data: insertedIngs, error: ingErr } = await supabaseAdmin
        .from("recipe_ingredients")
        .insert(ingredientRows)
        .select("id, position");
      if (ingErr || !insertedIngs) {
        console.error("[recipes] ingredients insert failed:", ingErr?.message);
        await rollbackRoot();
        return NextResponse.json(
          { error: "Ошибка при сохранении состава (ингредиенты)", details: ingErr?.message },
          { status: 500 }
        );
      }
      const idByPosition = new Map<number, string>();
      for (const row of insertedIngs as { id: string; position: number }[]) {
        idByPosition.set(Number(row.position), String(row.id));
      }
      const subsBuild = substituteRowsFromDto(
        idByPosition,
        ingredientsBuild.normalized
      );
      if (subsBuild.error) {
        console.error("[recipes] substitutes mapping failed:", subsBuild.error);
        await rollbackRoot();
        return NextResponse.json(
          { error: `substitutes: ${subsBuild.error}` },
          { status: 422 }
        );
      }
      if (subsBuild.rows.length > 0) {
        const { error: subsErr } = await supabaseAdmin
          .from("recipe_ingredient_substitutes")
          .insert(subsBuild.rows);
        if (subsErr) {
          console.error("[recipes] substitutes insert failed:", subsErr.message);
          await rollbackRoot();
          return NextResponse.json(
            { error: "Ошибка при сохранении состава (замены)", details: subsErr.message },
            { status: 500 }
          );
        }
      }
    }

    // 2c. Варианты
    const variantRows = variantRowsFromDto(recipeId, dto.variants ?? []).rows;
    if (variantRows.length > 0) {
      const { error: varErr } = await supabaseAdmin.from("recipe_variants").insert(variantRows);
      if (varErr) {
        console.error("[recipes] variants insert failed:", varErr.message);
        await rollbackRoot();
        return NextResponse.json(
          { error: "Ошибка при сохранении состава (варианты)", details: varErr.message },
          { status: 500 }
        );
      }
    }

    // 2d. Источник происхождения: rights_confirmed=false жёстко (RA.13)
    if (dto.source) {
      const { error: srcErr } = await supabaseAdmin
        .from("recipe_sources")
        .insert(sourceRowsFromDto(recipeId, [dto.source as SourceDto]).rows);
      if (srcErr) {
        console.error("[recipes] source insert failed:", srcErr.message);
        await rollbackRoot();
        return NextResponse.json(
          { error: "Ошибка при сохранении источника рецепта", details: srcErr.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { data: { id: recipeId, slug: root.slug, status: root.status } },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}

// ============================================================================
// GET /api/recipes — список рецептов автора (RECIPE-03, RB.14: «список своих
// через author_id»). Кабинет автора/кондитера читает ТОЛЬКО этот маршрут —
// никаких прямых записей в БД из UI.
//
// Query:
//   • scope=mine (по умолчанию) — только свои (author_id = текущий пользователь);
//   • scope=all — только ADMIN/SUPER_ADMIN (модерационные/админские обзоры);
//   • status=draft|pending_review|published|rejected|archived — фильтр;
//   • limit=1..200 (дефолт 50).
//
// Ответ: 200 {data: RecipeListRow[]}, RecipeListRow:
//   { id, title, slug, status, difficulty, prep_time_minutes, cook_time_minutes,
//     servings, category, tags, image_url, published_at, created_at, updated_at,
//     has_source, rights_confirmed (null = источников нет),
//     offer: { id, base_price, is_published } | null }   // активный мост 0068
// Цены в ответе — из оффера БД (ПР-1); клиент цену не задаёт.
// ============================================================================
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "all" ? "all" : "mine";
    const statusFilter = url.searchParams.get("status");
    const limitRaw = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;

    let authorId = user.userId;
    if (scope === "all") {
      const roles = await getUserRoles(user.userId);
      if (!roles.includes("ADMIN") && !roles.includes("SUPER_ADMIN")) {
        return NextResponse.json(
          { error: "scope=all доступен только ADMIN/SUPER_ADMIN" },
          { status: 403 }
        );
      }
      authorId = ""; // без фильтра по автору (админский обзор)
    }

    // Литеральный select (supabase-js 2.112: не-литеральный аргумент даёт
    // GenericStringError — паттерн ROOT_SELECT маршрута [id])
    let query = supabaseAdmin
      .from("recipes")
      .select(
        "id, title, slug, status, difficulty, prep_time_minutes, cook_time_minutes, servings, category, tags, image_url, published_at, created_at, updated_at"
      )
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (authorId) query = query.eq("author_id", authorId);
    if (
      statusFilter &&
      ["draft", "pending_review", "published", "rejected", "archived"].includes(statusFilter)
    ) {
      query = query.eq("status", statusFilter);
    }

    const { data: roots, error: rootsErr } = await query;
    if (rootsErr) {
      console.error("[recipes] GET list failed:", rootsErr.message);
      return NextResponse.json({ error: "Ошибка чтения рецептов" }, { status: 500 });
    }
    const rows = (roots ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return NextResponse.json({ data: [] });

    const ids = rows.map((r) => String(r.id));

    // Мост 0068: оффер (цена/публикация) на рецепт — один активный на рецепт
    const { data: offers } = await supabaseAdmin
      .from("recipe_marketplace")
      .select("id, recipe_id, base_price, is_published")
      .in("recipe_id", ids);
    const offerByRecipe = new Map<string, Record<string, unknown>>();
    for (const o of (offers ?? []) as Array<Record<string, unknown>>) {
      // детерминизм: приоритет активному офферу, иначе первый по порядку
      const prev = offerByRecipe.get(String(o.recipe_id));
      if (!prev || (o.is_published && !prev.is_published)) {
        offerByRecipe.set(String(o.recipe_id), o);
      }
    }

    // Права на импорт (RA.13): есть ли источники и подтверждены ли они
    const { data: sources } = await supabaseAdmin
      .from("recipe_sources")
      .select("recipe_id, rights_confirmed")
      .in("recipe_id", ids);
    const rightsByRecipe = new Map<string, { has: boolean; confirmed: boolean }>();
    for (const s of (sources ?? []) as Array<{ recipe_id: string; rights_confirmed: boolean | null }>) {
      const prev = rightsByRecipe.get(s.recipe_id) ?? { has: false, confirmed: true };
      prev.has = true;
      prev.confirmed = prev.confirmed && s.rights_confirmed !== false;
      rightsByRecipe.set(s.recipe_id, prev);
    }

    const data = rows.map((r) => {
      const id = String(r.id);
      const rights = rightsByRecipe.get(id) ?? null;
      const offer = offerByRecipe.get(id) ?? null;
      return {
        id,
        title: r.title,
        slug: r.slug,
        status: r.status ?? "draft",
        difficulty: r.difficulty,
        prep_time_minutes: r.prep_time_minutes,
        cook_time_minutes: r.cook_time_minutes,
        servings: r.servings,
        category: r.category,
        tags: r.tags ?? [],
        image_url: r.image_url,
        published_at: r.published_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        has_source: rights?.has ?? false,
        rights_confirmed: rights ? rights.confirmed : null,
        offer: offer
          ? {
              id: String(offer.id),
              base_price: Number(offer.base_price ?? 0),
              is_published: Boolean(offer.is_published),
            }
          : null,
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}
