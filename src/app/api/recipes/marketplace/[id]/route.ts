/**
 * /api/recipes/marketplace/[id]/route.ts — операции с конкретным рецептом.
 *
 * GET   /api/recipes/marketplace/:id  — карточка рецепта (public если опубликован, автор — черновик)
 * PATCH /api/recipes/marketplace/:id  — обновить (только автор)
 * DELETE /api/recipes/marketplace/:id  — удалить (только автор, soft-delete через is_published=false)
 *
 * Права:
 *  GET    — public (опубликованные) или author (черновики)
 *  PATCH  — только author_id == user.id
 *  DELETE — только author_id == user.id (или ADMIN)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import type { RecipeMarketplace } from "@/lib/supabase/types";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/recipes/marketplace/:id — карточка рецепта.
 * Если рецепт опубликован — виден всем.
 * Если нет — виден только автору.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const { data: recipe, error } = await supabaseAdmin
      .from("recipe_marketplace")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[recipes/:id] GET error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при получении рецепта" },
        { status: 500 }
      );
    }

    if (!recipe) {
      return NextResponse.json(
        { error: "Рецепт не найден" },
        { status: 404 }
      );
    }

    // Если рецепт не опубликован — проверить авторство
    if (!recipe.is_published) {
      const user = await getUserFromRequest(request);
      if (!user || user.id !== recipe.author_id) {
        return NextResponse.json(
          { error: "Рецепт не найден или ещё не опубликован" },
          { status: 404 }
        );
      }
    } else {
      // Увеличить счётчик просмотров (асинхронно, не блокируя ответ)
      // Используем Supabase RPC для атомарного инкремента
      supabaseAdmin
        .from("recipe_marketplace")
        .update({ views: (recipe.views || 0) + 1 })
        .eq("id", id)
        .then(() => { /* fire-and-forget */ });
    }

    return NextResponse.json({ data: recipe as RecipeMarketplace });
  } catch (error: any) {
    console.error("[recipes/:id] GET unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/recipes/marketplace/:id — обновить рецепт.
 * Только автор может обновлять свои рецепты.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Найти рецепт и проверить авторство
    const { data: recipe, error: fetchErr } = await supabaseAdmin
      .from("recipe_marketplace")
      .select("id, author_id, slug, title, is_published")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !recipe) {
      return NextResponse.json(
        { error: "Рецепт не найден" },
        { status: 404 }
      );
    }

    if (recipe.author_id !== user.id) {
      return NextResponse.json(
        { error: "Только автор может редактировать рецепт" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Разрешённые к обновлению поля (всё остальное игнорируется)
    const allowed: Record<string, unknown> = {};
    const allowedFields = [
      "title", "description", "base_price", "is_premium", "premium_price",
      "royalty_rate", "cooking_time_min", "difficulty", "tags",
      "preview_image", "steps_json", "ingredients_json",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        allowed[field] = body[field];
      }
    }

    // Если title меняется — пересчитать slug
    if (body.title && body.title !== recipe.title) {
      const newSlug = generateSlug(body.title);
      // Проверить уникальность нового slug
      const { data: existing } = await supabaseAdmin
        .from("recipe_marketplace")
        .select("id")
        .eq("slug", newSlug)
        .neq("id", id)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { error: "Рецепт с похожим названием уже существует" },
          { status: 409 }
        );
      }
      allowed.slug = newSlug;
    }

    // Если is_published меняется с false на true — установить published_at
    if (body.is_published === true && !recipe.is_published) {
      allowed.is_published = true;
      allowed.published_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabaseAdmin
      .from("recipe_marketplace")
      .update(allowed)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[recipes/:id] PATCH error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при обновлении", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: updated as RecipeMarketplace });
  } catch (error: any) {
    console.error("[recipes/:id] PATCH unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/recipes/marketplace/:id — soft-delete (is_published=false).
 * Полное удаление — только через ADMIN.
 * Если есть покупки — нельзя удалить полностью (защита от потери данных для покупателей).
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Найти рецепт
    const { data: recipe, error: fetchErr } = await supabaseAdmin
      .from("recipe_marketplace")
      .select("id, author_id, is_published, purchases_count")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !recipe) {
      return NextResponse.json(
        { error: "Рецепт не найден" },
        { status: 404 }
      );
    }

    // Проверить права: автор или ADMIN
    const isAuthor = recipe.author_id === user.id;
    const adminCheck = await isAdmin(user.id);
    if (!isAuthor && !adminCheck) {
      return NextResponse.json(
        { error: "У вас нет прав на удаление этого рецепта" },
        { status: 403 }
      );
    }

    // Если есть покупки — только soft-delete (снятие с публикации)
    if (recipe.purchases_count > 0) {
      const { error: softDeleteErr } = await supabaseAdmin
        .from("recipe_marketplace")
        .update({ is_published: false })
        .eq("id", id);

      if (softDeleteErr) {
        console.error("[recipes/:id] DELETE soft-delete error:", softDeleteErr.message);
        return NextResponse.json(
          { error: "Ошибка при снятии с публикации" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        data: { id },
        message: "Рецепт снят с публикации (есть покупки — полное удаление невозможно)",
      });
    }

    // Нет покупок — можно полностью удалить
    const { error: deleteErr } = await supabaseAdmin
      .from("recipe_marketplace")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error("[recipes/:id] DELETE error:", deleteErr.message);
      return NextResponse.json(
        { error: "Ошибка при удалении" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: { id },
      message: "Рецепт удалён",
    });
  } catch (error: any) {
    console.error("[recipes/:id] DELETE unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * Slug generator (дублируется из route.ts, чтобы модуль был автономным).
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
