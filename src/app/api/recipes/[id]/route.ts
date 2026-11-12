/**
 * /api/recipes/[id]/route.ts — карточка, правка и архивация корневого рецепта
 * (RECIPE-02, RB.14: «/api/recipes/[id] (новый)»).
 *
 * GET    — полный состав (root + дети одним DTO). Чужим пользователям доступ
 *          решает ЕДИНЫЙ Access Resolver (RA.9): preview/full, при level='none'
 *          → 404 (существование черновика не раскрывается). gateRecipeContent
 *          удаляет steps/ingredients/substitutes/variants/media/content при
 *          level!=='full'; published без платного оффера → FREE_CONTENT/full —
 *          это решает Resolver. recipe_sources отдаётся только автору/ADMIN
 *          (RB.16: «raw_payload закрыт всем прочим»).
 * PATCH  — автор или ADMIN (ownership серверно). Обновляет поля корня; состав
 *          заменяется ПОЛНОСТЬЮ (DELETE старые + INSERT новые) при передаче
 *          массивов в теле; не переданные типы детей не трогаются. Правки
 *          published-рецепта оставляют статус published — история живёт в
 *          неизменяемых версиях (RA.8.1). Для status='archived' PATCH запрещён
 *          (409) кроме восстановления: PATCH {status:"draft"} (RB.15:
 *          archived→draft, автор).
 * DELETE — soft-delete: status='archived' (автор или ADMIN). Повтор → 200.
 *          Активный оффер НЕ скрывается (оффер управляется отдельным
 *          маршрутом) — в ответе возвращается offerLinked: true.
 *
 * Атомарность замены состава (Z-v32, ZV31-003): корень и ВСЕ переданные
 * типы детей заменяются ОДНИМ БД-RPC update_recipe_with_ingredients
 * (миграция 0081) — одна SQL-функция = одна транзакция: блокировка строки
 * корня FOR UPDATE → UPDATE корня (только переданные ключи) → DELETE +
 * INSERT детей (substitutes резолвятся по ingredient_position внутри
 * транзакции). Конкурентный читатель (live-путь breakdown / снапшот
 * checkout — один statement по MVCC) видит ЛИБО целиком старое, ЛИБО
 * целиком новое состояние состава — промежуточный «пустой/частичный
 * состав» невозможен. Компенсирующий откат больше не нужен: при любой
 * ошибке позиций полный откат в БД, читателю — 500.
 * ВАЖНО: замена steps каскадно удаляет привязанные к шагам media
 * (recipe_media.step_id ON DELETE CASCADE, 0066) — манифест медиа при этом
 * сохраняется в неизменяемых версиях (RA.8.1).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import {
  resolveRecipeAccess,
  gateRecipeContent,
} from "@/lib/recipes/access-resolver";
import {
  generateSlug,
  normalizePositions,
  stepRowsFromDto,
  ingredientRowsFromDto,
  variantRowsFromDto,
  sourceRowsFromDto,
  fetchRecipeChildren,
  assembleRecipeDto,
  type SourceDto,
} from "@/lib/recipes/recipe-content";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Строчный литерал (не join-переменная): supabase-js v2.112 парсит список
// колонок из литерала и типирует результат; строковый тип → data: GenericStringError
const ROOT_SELECT = [
  "id, author_id, title, subtitle, description, content",
  "difficulty, prep_time_minutes, cook_time_minutes, servings",
  "calories_per_serving, protein_g, fat_g, carb_g",
  "tags, category, equipment, allergens, yield_text, storage_note",
  "image_url, video_url, slug, status, legacy_content_mdx",
  "published_at, created_at, updated_at",
].join(", ") as "id, author_id, title, subtitle, description, content, difficulty, prep_time_minutes, cook_time_minutes, servings, calories_per_serving, protein_g, fat_g, carb_g, tags, category, equipment, allergens, yield_text, storage_note, image_url, video_url, slug, status, legacy_content_mdx, published_at, created_at, updated_at";

// ---------- Zod-схемы PATCH (все поля опциональны) ----------
const UNIT = ["г", "мл", "шт"] as const;

const substituteSchema = z.object({
  name: z.string().min(1).max(200),
  qty: z.number().positive().nullable().optional(),
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
  description: z.string().min(1).max(5000),
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
  raw_payload: z.unknown().optional(),
});

const patchSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().min(1).max(5000).optional(),
  subtitle: z.string().max(300).nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  prep_time_minutes: z.number().int().min(0).max(10080).nullable().optional(),
  cook_time_minutes: z.number().int().min(0).max(10080).nullable().optional(),
  servings: z.number().int().min(1).max(500).nullable().optional(),
  calories_per_serving: z.number().int().min(0).max(10000).nullable().optional(),
  protein_g: z.number().min(0).max(500).nullable().optional(),
  fat_g: z.number().min(0).max(500).nullable().optional(),
  carb_g: z.number().min(0).max(500).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  category: z.string().max(100).nullable().optional(),
  equipment: z.array(z.string().min(1).max(100)).max(30).optional(),
  allergens: z
    .array(
      z.enum([
        "milk", "eggs", "gluten", "nuts", "peanuts", "soy", "fish", "shellfish", "sesame",
      ])
    )
    .max(15)
    .optional(),
  yield_text: z.string().max(200).nullable().optional(),
  storage_note: z.string().max(500).nullable().optional(),
  // Состав — полная замена соответствующего типа детей при передаче массива
  ingredients: z.array(ingredientSchema).max(100).optional(),
  steps: z.array(stepSchema).max(100).optional(),
  variants: z.array(variantSchema).max(20).optional(),
  sources: z.array(sourceSchema).max(10).optional(), // полная замена источников
  source: sourceSchema.optional(), // симметрия с POST: 1 источник → замена
  // Статус клиентом не управляется, КРОМЕ восстановления из архива (RB.15)
  status: z.literal("draft").optional(),
  // ВНЕ СХЕМЫ (игнорируется): цены/author_id/created_at/published_at/slug/id
});

/** Есть ли активный (опубликованный) оффер на рецепт. */
async function hasActiveOffer(recipeId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("recipe_marketplace")
    .select("id")
    .eq("recipe_id", recipeId)
    .eq("is_published", true)
    .limit(1);
  return Boolean(data && data.length > 0);
}

// ============================================================
// GET /api/recipes/[id]
// ============================================================
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { data: root, error } = await supabaseAdmin
      .from("recipes")
      .select(ROOT_SELECT)
      .eq("id", id)
      .maybeSingle();

    // Паттерн существующих маршрутов: комбинированная проверка
    // (раздельные if(error)/if(!root) ломают сужение union-типа PostgREST)
    if (error || !root) {
      if (error) console.error("[recipes/:id] GET error:", error.message);
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }

    const user = await getUserFromRequest(request);

    // ЕДИНЫЙ Resolver (RA.9) — никакого собственного решения доступа здесь нет
    const access = await resolveRecipeAccess(user, {
      id: String(root.id),
      author_id: String(root.author_id),
      status: String(root.status ?? "draft"),
    });
    if (access.level === "none") {
      // NOT_PUBLISHED: не раскрываем существование непубликуемого рецепта
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }

    const children = await fetchRecipeChildren(id);
    const dto = assembleRecipeDto(root as unknown as Record<string, unknown>, children);

    // RB.16: recipe_sources (включая raw_payload) — только автор и ADMIN
    const isOwner = Boolean(user && user.userId === root.author_id);
    const staffAdmin = Boolean(user && (await isAdmin(user.userId)));
    if (!isOwner && !staffAdmin) {
      delete dto.sources;
    }

    // Пейволл-гейт состава (фикс D4): preview → без steps/ingredients/…
    const gated = gateRecipeContent(access, dto);

    return NextResponse.json({
      data: gated,
      meta: { access_level: access.level, access_reason: access.reason },
    });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes/[id]",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}

// ============================================================
// PATCH /api/recipes/[id]
// ============================================================
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    const { data: root, error: fetchErr } = await supabaseAdmin
      .from("recipes")
      .select("id, author_id, title, slug, status, published_at, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !root) {
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }

    // Ownership — серверно: автор или ADMIN
    const isAuthor = root.author_id === user.userId;
    const admin = await isAdmin(user.userId);
    if (!isAuthor && !admin) {
      return NextResponse.json(
        { error: "Только автор или администратор может редактировать рецепт" },
        { status: 403 }
      );
    }

    const { data: body, error: parseErr } = await safeJsonBodyPatch(request);
    if (parseErr) return NextResponse.json({ error: parseErr }, { status: 400 });

    const parsed = patchSchema.safeParse(body);
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
    const recipeId = String(root.id);

    const offerLinked = await hasActiveOffer(recipeId);

    // archived: только восстановление (RB.15: archived→draft, автор)
    if (root.status === "archived") {
      if (dto.status === "draft") {
        const { error: restoreErr } = await supabaseAdmin
          .from("recipes")
          .update({ status: "draft", updated_at: new Date().toISOString() })
          .eq("id", recipeId);
        if (restoreErr) {
          console.error("[recipes/:id] restore error:", restoreErr.message);
          return NextResponse.json({ error: "Ошибка при восстановлении" }, { status: 500 });
        }
        return NextResponse.json({
          data: { id: recipeId, status: "draft", offerLinked },
          message: "Рецепт восстановлен из архива в черновик",
        });
      }
      return NextResponse.json(
        {
          error:
            'Рецепт находится в архиве — доступно только восстановление: PATCH {status:"draft"}',
        },
        { status: 409 }
      );
    }

    // ---------- Поля корня (whitelist; клиентский status/author_id игнорируются) ----------
    const upd: Record<string, unknown> = {};
    if (dto.title !== undefined && dto.title !== root.title) {
      upd.title = dto.title.trim();
      // Пересчёт slug при смене title + проверка уникальности
      const newSlug = generateSlug(dto.title);
      const { data: slugTaken } = await supabaseAdmin
        .from("recipes")
        .select("id")
        .eq("slug", newSlug)
        .neq("id", recipeId)
        .limit(1);
      if (slugTaken && slugTaken.length > 0) {
        return NextResponse.json(
          { error: "Рецепт с похожим названием уже существует — измените title" },
          { status: 409 }
        );
      }
      upd.slug = newSlug;
    }
    if (dto.description !== undefined) upd.description = dto.description.trim();
    if (dto.subtitle !== undefined) upd.subtitle = dto.subtitle?.trim() || null;
    if (dto.difficulty !== undefined) upd.difficulty = dto.difficulty;
    if (dto.prep_time_minutes !== undefined) upd.prep_time_minutes = dto.prep_time_minutes;
    if (dto.cook_time_minutes !== undefined) upd.cook_time_minutes = dto.cook_time_minutes;
    if (dto.servings !== undefined) upd.servings = dto.servings;
    if (dto.calories_per_serving !== undefined) upd.calories_per_serving = dto.calories_per_serving;
    if (dto.protein_g !== undefined) upd.protein_g = dto.protein_g;
    if (dto.fat_g !== undefined) upd.fat_g = dto.fat_g;
    if (dto.carb_g !== undefined) upd.carb_g = dto.carb_g;
    if (dto.tags !== undefined) upd.tags = dto.tags;
    if (dto.category !== undefined) upd.category = dto.category?.trim() || null;
    if (dto.equipment !== undefined) upd.equipment = dto.equipment;
    if (dto.allergens !== undefined) upd.allergens = dto.allergens;
    if (dto.yield_text !== undefined) upd.yield_text = dto.yield_text?.trim() || null;
    if (dto.storage_note !== undefined) upd.storage_note = dto.storage_note?.trim() || null;

    // ---------- Состав: полная замена переданных типов детей ----------
    // Валидация ДО удаления старых строк (422 без частичного состояния)
    const stepsBuild = dto.steps !== undefined ? stepRowsFromDto(recipeId, dto.steps) : null;
    if (stepsBuild?.error) {
      return NextResponse.json({ error: `steps: ${stepsBuild.error}` }, { status: 422 });
    }
    const ingredientsBuild =
      dto.ingredients !== undefined ? ingredientRowsFromDto(recipeId, dto.ingredients) : null;
    if (ingredientsBuild?.error) {
      return NextResponse.json({ error: `ingredients: ${ingredientsBuild.error}` }, { status: 422 });
    }
    // Позиции замен валидируем против НОРМАЛИЗОВАННОГО списка ингредиентов
    for (const ing of ingredientsBuild?.normalized ?? []) {
      if (!ing.substitutes?.length) continue;
      const subNorm = normalizePositions(ing.substitutes);
      if (subNorm.error) {
        return NextResponse.json(
          { error: `ingredients.substitutes: ${subNorm.error}` },
          { status: 422 }
        );
      }
    }
    const variantsBuild =
      dto.variants !== undefined ? variantRowsFromDto(recipeId, dto.variants) : null;
    if (variantsBuild?.error) {
      return NextResponse.json({ error: `variants: ${variantsBuild.error}` }, { status: 422 });
    }
    const sourceDtoList: SourceDto[] | undefined =
      dto.sources !== undefined ? dto.sources : dto.source !== undefined ? [dto.source] : undefined;
    const sourcesBuild = sourceDtoList ? sourceRowsFromDto(recipeId, sourceDtoList) : null;
    if (sourcesBuild?.error) {
      return NextResponse.json({ error: `sources: ${sourcesBuild.error}` }, { status: 422 });
    }

    // updated_at — серверно (updated_at-триггера на recipes нет); именно эта
    // метка используется publish-идемпотентностью (версия новее → контент
    // изменился → новая версия). Bump при ЛЮБОМ изменении: поля корня ИЛИ
    // замена состава (иначе чистая замена детей не создала бы новую версию).
    const hasChildrenReplacement =
      stepsBuild !== null ||
      ingredientsBuild !== null ||
      variantsBuild !== null ||
      sourcesBuild !== null;
    if (Object.keys(upd).length > 0 || hasChildrenReplacement) {
      upd.updated_at = new Date().toISOString();
    }

    // Замены ингредиентов: привязка к НОРМАЛИЗОВАННОЙ position — реальный id
    // резолвится ВНУТРИ транзакции RPC на свежевставленных строках
    // (паритет substituteRowsFromDto, только ingredient_position вместо id).
    const substituteRows: Array<{
      ingredient_position: number;
      name: string;
      qty: number | null;
      unit: string | null;
      position: number;
    }> = [];
    if (ingredientsBuild) {
      for (const ing of ingredientsBuild.normalized) {
        if (!ing.substitutes?.length) continue;
        if (ing.position === undefined) {
          return NextResponse.json(
            { error: "ingredients.substitutes: Не удалось сопоставить замену с ингредиентом (position)" },
            { status: 422 }
          );
        }
        const subNorm = normalizePositions(ing.substitutes);
        if (subNorm.error) {
          return NextResponse.json(
            { error: `ingredients.substitutes: ${subNorm.error}` },
            { status: 422 }
          );
        }
        for (const sub of subNorm.rows) {
          if (sub.position === undefined) {
            return NextResponse.json(
              { error: "ingredients.substitutes: Не удалось сопоставить замену с ингредиентом (position)" },
              { status: 422 }
            );
          }
          substituteRows.push({
            ingredient_position: ing.position,
            name: sub.name.trim(),
            qty: sub.qty ?? null,
            unit: sub.unit?.trim() || null,
            position: sub.position,
          });
        }
      }
    }

    // Z-v32 (ZV31-003): корень + состав — ОДИН атомарный БД-RPC (0081):
    // одна транзакция = один консистентный снимок для читателей. NULL-параметр
    // = тип детей не трогается; '[]' = полная очистка. Ошибка любой вставки →
    // полный откат в БД (ни движений, ни частичного состояния).
    const { error: patchRpcErr } = (await supabaseAdmin.rpc(
      "update_recipe_with_ingredients",
      {
        p_recipe_id: recipeId,
        p_root: Object.keys(upd).length > 0 ? upd : null,
        p_steps: stepsBuild ? stepsBuild.rows : null,
        p_ingredients: ingredientsBuild ? ingredientsBuild.rows : null,
        p_substitutes:
          ingredientsBuild && substituteRows.length > 0 ? substituteRows : null,
        p_variants: variantsBuild ? variantsBuild.rows : null,
        p_sources: sourcesBuild ? sourcesBuild.rows : null,
      }
    )) as unknown as {
      data: unknown;
      error: (Error & { code?: string }) | null;
    };

    if (patchRpcErr && patchRpcErr.code === "PGRST202") {
      // fail-closed: RPC отсутствует — состав НЕ правим частично (примените 0081)
      console.error(
        "[recipes/:id] update_recipe_with_ingredients RPC отсутствует — fail-closed (примените миграцию 0081)"
      );
      return NextResponse.json(
        { error: "Обновление состава недоступно (примените миграцию 0081)" },
        { status: 500 }
      );
    }
    if (patchRpcErr) {
      console.error("[recipes/:id] PATCH RPC error:", patchRpcErr.message);
      const notFound = patchRpcErr.message.includes("[recipe_patch] not_found");
      return NextResponse.json(
        {
          error: notFound
            ? "Рецепт не найден"
            : "Ошибка при обновлении рецепта",
          details: patchRpcErr.message,
        },
        { status: notFound ? 404 : 500 }
      );
    }

    return NextResponse.json({
      data: { id: recipeId, status: root.status, offerLinked },
      message: "Рецепт обновлён",
    });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes/[id]",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}

// ============================================================
// DELETE /api/recipes/[id] — soft-delete: status='archived'
// ============================================================
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    const { data: root, error: fetchErr } = await supabaseAdmin
      .from("recipes")
      .select("id, author_id, status")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !root) {
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }

    const isAuthor = root.author_id === user.userId;
    const admin = await isAdmin(user.userId);
    if (!isAuthor && !admin) {
      return NextResponse.json(
        { error: "Только автор или администратор может архивировать рецепт" },
        { status: 403 }
      );
    }

    const recipeId = String(root.id);
    const offerLinked = await hasActiveOffer(recipeId);

    // Идемпотентность: уже в архиве → 200 без записи
    if (root.status === "archived") {
      return NextResponse.json({
        data: { id: recipeId, status: "archived", offerLinked },
        message: "Рецепт уже находится в архиве",
      });
    }

    // RB.15: published→archived (автор) / draft→archived (автор)
    const { error: updErr } = await supabaseAdmin
      .from("recipes")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", recipeId);

    if (updErr) {
      console.error("[recipes/:id] DELETE archive error:", updErr.message);
      return NextResponse.json({ error: "Ошибка при архивации" }, { status: 500 });
    }

    return NextResponse.json({
      data: { id: recipeId, status: "archived", offerLinked },
      message: offerLinked
        ? "Рецепт перемещён в архив. Активный оффер не скрыт — он управляется отдельным маршрутом /api/recipes/marketplace/[id]"
        : "Рецепт перемещён в архив (восстановление: PATCH {status:\"draft\"})",
    });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes/[id]",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}

// ============================================================
// Внутренние хелперы PATCH
// ============================================================
async function safeJsonBodyPatch(
  request: NextRequest
): Promise<{ data: unknown; error: string | null }> {
  try {
    const raw = await request.text();
    if (!raw) return { data: null, error: "Тело запроса пусто" };
    return { data: JSON.parse(raw) as unknown, error: null };
  } catch (e: any) {
    return { data: null, error: `Невалидный JSON: ${e?.message || "parse error"}` };
  }
}
