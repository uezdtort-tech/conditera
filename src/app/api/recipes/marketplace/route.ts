/**
 * /api/recipes/marketplace/route.ts — CRUD для маркетплейса авторских рецептов.
 *
 * GET  /api/recipes/marketplace         — список опубликованных рецептов (public)
 * POST /api/recipes/marketplace         — создать новый рецепт (только RECIPE_DEVELOPER)
 *
 * Query параметры для GET:
 *  - q          — поиск по title/description (ILIKE)
 *  - tag        — фильтр по тегу (входит в tags[])
 *  - author_id  — фильтр по автору
 *  - difficulty — 1-5
 *  - is_premium — true/false
 *  - sort       — popular | newest | rating | price_asc | price_desc
 *  - limit      — по умолчанию 20, макс 100
 *  - offset     — по умолчанию 0
 *
 * Права:
 *  GET  — public (опубликованные рецепты видны всем)
 *  POST — RECIPE_DEVELOPER only (проверка через requireRole)
 *
 * Соответствует таблицам:
 *  - recipe_marketplace (миграция 0012)
 *  - user_roles (миграция 0001)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import type { RecipeMarketplace } from "@/lib/supabase/types";

/**
 * Postgres numeric/int8 через PostgREST-шим приходит строкой ("500.00") —
 * приводим числовые поля к number для JSON-контракта API (types объявляют number).
 */
const NUMERIC_FIELDS = ["base_price", "premium_price", "royalty_rate", "rating"] as const;

function coerceRecipeNumbers<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const f of NUMERIC_FIELDS) {
      const v = out[f];
      if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
        out[f] = Number(v);
      }
    }
    return out as T;
  });
}

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * GET /api/recipes/marketplace — список опубликованных рецептов.
 * Public endpoint, не требует аутентификации.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    const tag = searchParams.get("tag");
    const authorId = searchParams.get("author_id");
    const difficulty = searchParams.get("difficulty");
    const isPremium = searchParams.get("is_premium");
    const sort = searchParams.get("sort") || "newest";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Базовый запрос — только опубликованные рецепты
    let query = supabaseAdmin
      .from("recipe_marketplace")
      .select(
        `
        id, author_id, title, slug, description, base_price, is_premium,
        is_published, premium_price, royalty_rate, cooking_time_min, difficulty, tags,
        preview_image, views, purchases_count, rating, published_at,
        created_at, updated_at
      `
      )
      .eq("is_published", true);

    // Фильтр по автору
    if (authorId) {
      query = query.eq("author_id", authorId);
    }

    // Фильтр по сложности
    if (difficulty) {
      const diffNum = parseInt(difficulty, 10);
      if (diffNum >= 1 && diffNum <= 5) {
        query = query.eq("difficulty", diffNum);
      }
    }

    // Фильтр по премиум-флагу
    if (isPremium === "true") {
      query = query.eq("is_premium", true);
    } else if (isPremium === "false") {
      query = query.eq("is_premium", false);
    }

    // Поиск по названию и описанию (ILIKE)
    if (q) {
      query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
    }

    // Фильтр по тегу (содержит в массиве tags[])
    if (tag) {
      query = query.contains("tags", [tag]);
    }

    // Сортировка
    switch (sort) {
      case "popular":
        query = query.order("views", { ascending: false });
        break;
      case "rating":
        query = query.order("rating", { ascending: false });
        break;
      case "price_asc":
        query = query.order("base_price", { ascending: true });
        break;
      case "price_desc":
        query = query.order("base_price", { ascending: false });
        break;
      case "newest":
      default:
        query = query.order("published_at", { ascending: false });
        break;
    }

    // Пагинация
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("[recipes/marketplace] GET error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при получении списка рецептов", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: coerceRecipeNumbers(data || []),
      meta: {
        total: count ?? data?.length ?? 0,
        limit,
        offset,
        hasMore: (data?.length ?? 0) === limit,
      },
    });
  } catch (error: any) {
    console.error("[recipes/marketplace] GET unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/recipes/marketplace — создать новый рецепт.
 * Только RECIPE_DEVELOPER.
 *
 * Тело запроса:
 *  {
 *    "title": "Шоколадный торт с малиной",
 *    "description": "Авторский рецепт...",
 *    "base_price": 500,
 *    "is_premium": false,
 *    "premium_price": null,
 *    "royalty_rate": 0.05,
 *    "cooking_time_min": 180,
 *    "difficulty": 3,
 *    "tags": ["chocolate", "raspberry", "wedding"],
 *    "preview_image": "https://...",
 *    "steps_json": [{step_number:1, description:"..."}],
 *    "ingredients_json": [{name:"Мука", qty:"300", unit:"г"}],
 *    "is_published": false
 *  }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Проверка роли — только RECIPE_DEVELOPER может создавать рецепты
    const guard = await requireRole(user.id, "RECIPE_DEVELOPER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json();

    // Валидация обязательных полей
    const required = ["title", "description", "base_price", "steps_json", "ingredients_json"];
    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        return NextResponse.json(
          { error: `Поле «${field}» обязательно`, field },
          { status: 422 }
        );
      }
    }

    // Валидация типов
    if (typeof body.title !== "string" || body.title.length < 3 || body.title.length > 200) {
      return NextResponse.json(
        { error: "title должен быть строкой 3-200 символов" },
        { status: 422 }
      );
    }
    if (typeof body.base_price !== "number" || body.base_price < 0) {
      return NextResponse.json(
        { error: "base_price должен быть неотрицательным числом" },
        { status: 422 }
      );
    }
    if (body.royalty_rate !== undefined && (typeof body.royalty_rate !== "number" || body.royalty_rate < 0 || body.royalty_rate > 1)) {
      return NextResponse.json(
        { error: "royalty_rate должен быть числом от 0 до 1" },
        { status: 422 }
      );
    }
    if (body.difficulty !== undefined && (typeof body.difficulty !== "number" || body.difficulty < 1 || body.difficulty > 5)) {
      return NextResponse.json(
        { error: "difficulty должен быть числом от 1 до 5" },
        { status: 422 }
      );
    }

    // Генерировать slug из title (транслитерация + lowercase + dash)
    const slug = generateSlug(body.title);

    // Проверить уникальность slug
    const { data: existing } = await supabaseAdmin
      .from("recipe_marketplace")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "Рецепт с похожим названием уже существует — измените title" },
        { status: 409 }
      );
    }

    // ПР-1 (RECIPE-01A): каждый оффер обязан ссылаться на корневой рецепт.
    // 1) создаём корневую строку recipes (content='' — MDX-тела нет, состав
    //    живёт в steps_json/ingredients_json + детях двойной записи);
    // 2) создаём оффер с recipe_id;
    // 3) при ошибке оффера — откат корневой строки (только что создана).
    const rootSlug = slug;
    const { data: rootRecipe, error: rootErr } = await supabaseAdmin
      .from("recipes")
      .insert({
        author_id: user.id,
        title: body.title,
        description: body.description,
        content: "",
        difficulty:
          typeof body.difficulty === "number"
            ? body.difficulty <= 2
              ? "easy"
              : body.difficulty === 3
                ? "medium"
                : "hard"
            : null,
        cook_time_minutes: body.cooking_time_min ?? null,
        tags: Array.isArray(body.tags) ? body.tags : [],
        image_url: body.preview_image ?? null,
        status: body.is_published ? "published" : "draft",
        published_at: body.is_published ? new Date().toISOString() : null,
        slug: rootSlug,
      })
      .select("id")
      .single();

    if (rootErr || !rootRecipe) {
      // 23505 = recipes.slug UNIQUE — та же UX-семантика, что и у оффер-слага
      const isSlugConflict = (rootErr as { code?: string } | null)?.code === "23505";
      console.error("[recipes/marketplace] root recipe insert failed:", rootErr?.message);
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

    // Создать оффер, связанный с корневым рецептом (0068-модель)
    const insertData = {
      author_id: user.id,
      title: body.title,
      slug,
      description: body.description,
      recipe_id: rootRecipe.id,
      base_price: body.base_price,
      is_premium: Boolean(body.is_premium),
      premium_price: body.premium_price ?? null,
      royalty_rate: body.royalty_rate ?? 0.05,
      cooking_time_min: body.cooking_time_min ?? null,
      difficulty: body.difficulty ?? null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      preview_image: body.preview_image ?? null,
      steps_json: body.steps_json,
      ingredients_json: body.ingredients_json,
      is_published: Boolean(body.is_published),
      published_at: body.is_published ? new Date().toISOString() : null,
    };

    const { data: created, error } = await supabaseAdmin
      .from("recipe_marketplace")
      .insert(insertData)
      .select()
      .single();

    if (error || !created) {
      // Откат корневой строки (детей ещё нет; оффер не создан)
      await supabaseAdmin.from("recipes").delete().eq("id", rootRecipe.id);
      console.error("[recipes/marketplace] POST error:", error?.message ?? "no row returned");
      return NextResponse.json(
        { error: "Ошибка при создании рецепта", details: error?.message ?? "no row returned" },
        { status: 500 }
      );
    }

    // Двойная запись (RA.17.4): JSONB → дети (recipe_steps/recipe_ingredients),
    // best-effort: при сбое остаётся замороженный JSONB-носитель (0069-семантика)
    try {
      const stepsDto = Array.isArray(body.steps_json) ? body.steps_json : [];
      if (stepsDto.length > 0) {
        const stepRows = stepsDto
          .map((s: { description?: unknown; step_number?: unknown }, i: number) => ({
            recipe_id: rootRecipe.id,
            position: Number(s.step_number) || i + 1,
            description:
              typeof s.description === "string" && s.description.trim() ? s.description.trim() : null,
          }))
          .filter((r: { description: string | null }) => r.description !== null);
        if (stepRows.length > 0) {
          const { error: stepsErr } = await supabaseAdmin.from("recipe_steps").insert(stepRows);
          if (stepsErr) console.error("[recipes/marketplace] steps double-write failed:", stepsErr.message);
        }
      }
      const ingDto = Array.isArray(body.ingredients_json) ? body.ingredients_json : [];
      if (ingDto.length > 0) {
        const ingRows = ingDto
          .map((i: { name?: unknown; qty?: unknown; unit?: unknown }, idx: number) => {
            const rawQty = i.qty;
            let qty: number | null = null;
            if (typeof rawQty === "number" && Number.isFinite(rawQty) && rawQty > 0) qty = rawQty;
            else if (typeof rawQty === "string" && rawQty.trim().match(/^[0-9]+([.,][0-9]+)?$/)) {
              qty = Number(rawQty.trim().replace(",", "."));
            }
            return {
              recipe_id: rootRecipe.id,
              name: typeof i.name === "string" && i.name.trim() ? i.name.trim() : null,
              qty,
              unit: typeof i.unit === "string" && i.unit.trim() ? i.unit.trim() : "шт",
              sort_order: idx,
              position: idx + 1,
            };
          })
          .filter((r: { name: string | null }) => r.name !== null);
        if (ingRows.length > 0) {
          const { error: ingErr } = await supabaseAdmin.from("recipe_ingredients").insert(ingRows);
          if (ingErr) console.error("[recipes/marketplace] ingredients double-write failed:", ingErr.message);
        }
      }
    } catch (dwError) {
      console.error("[recipes/marketplace] double-write unexpected:", (dwError as Error)?.message);
    }

    return NextResponse.json(
      { data: created as RecipeMarketplace, message: "Рецепт создан" },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[recipes/marketplace] POST unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * Простой slug-генератор для русского/латинского текста.
 * "Шоколадный торт с малиной" → "shokoladnyy-tort-s-malinoy"
 */
function generateSlug(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e",
    ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
    ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const transliterated = text
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("");
  return transliterated
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 200);
}
