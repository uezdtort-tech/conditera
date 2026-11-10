/**
 * GET /api/recipes/[id]/scale?servings=N — display-only пересчёт состава
 * на другое число порций (RECIPE-02, RB.14 «/api/recipes/[id]/scale»).
 *
 * Доступ: как GET карточки — через ЕДИНЫЙ Access Resolver (RA.9). Требуется
 * level='full': preview НЕ масштабирует (пейволл: нельзя получить полный
 * состав пересчётом); level='none' → 404 (существование не раскрывается).
 *
 * Параметр servings: целое 1..500 — иначе 422. База масштабирования —
 * servings корня (recipes.servings); при отсутствующем/нулевом → 422.
 *
 * Правила пересчёта:
 *   • ingredients.qty *= N / servings_root — только для qty IS NOT NULL;
 *     qty NULL («по вкусу») НЕ масштабируется (миграция 0067, Q-2);
 *   • substitutes.qty — та же пропорция (display-only аналогично);
 *   • display_qty/is_optional/prep_note/group_title не изменяются;
 *   • steps/media/variants — без изменений (пересчёт состава, не контента);
 *   • БД НЕ пишется — ответ только в памяти (display-only).
 *
 * Ответ: 200 {data: {...DTO, ingredients[]}, meta: {servings, base_servings, factor}}.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { resolveRecipeAccess } from "@/lib/recipes/access-resolver";
import {
  fetchRecipeChildren,
  assembleRecipeDto,
  round3,
} from "@/lib/recipes/recipe-content";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 500;

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const rawServings = searchParams.get("servings");

    const servings = rawServings === null ? NaN : Number(rawServings);
    if (
      !Number.isInteger(servings) ||
      servings < MIN_SERVINGS ||
      servings > MAX_SERVINGS
    ) {
      return NextResponse.json(
        { error: `servings должен быть целым числом от ${MIN_SERVINGS} до ${MAX_SERVINGS}` },
        { status: 422 }
      );
    }

    const { data: root, error: fetchErr } = await supabaseAdmin
      .from("recipes")
      .select("id, author_id, status, title, slug, servings")
      .eq("id", id)
      .maybeSingle();

    // Комбинированная проверка (сужение union-типа PostgREST, паттерн маршрутов)
    if (fetchErr || !root) {
      if (fetchErr) console.error("[recipes/scale] root error:", fetchErr.message);
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }

    const user = await getUserFromRequest(request);
    const access = await resolveRecipeAccess(user, {
      id: String(root.id),
      author_id: String(root.author_id),
      status: String(root.status ?? "draft"),
    });

    if (access.level === "none") {
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }
    if (access.level !== "full") {
      // preview (PAID_NOT_PURCHASED / REVOKED_REFUND) не масштабируется —
      // иначе пересчёт раскрыл бы платный состав
      return NextResponse.json(
        {
          error: "Масштабирование доступно только при полном доступе к составу",
          access_reason: access.reason,
        },
        { status: 403 }
      );
    }

    const baseServings = Number(root.servings);
    if (!Number.isFinite(baseServings) || baseServings <= 0) {
      return NextResponse.json(
        { error: "У рецепта не указано базовое число порций — масштабирование невозможно" },
        { status: 422 }
      );
    }

    const factor = servings / baseServings;

    const children = await fetchRecipeChildren(String(root.id));
    const dto = assembleRecipeDto(root as unknown as Record<string, unknown>, children);

    // Display-only пересчёт: qty IS NOT NULL → qty * factor; NULL («по вкусу»)
    // остаётся NULL. Округление до 3 знаков (numeric(12,3) в схеме).
    const scaledIngredients = (dto.ingredients as Record<string, unknown>[]).map((ing) => {
      const qty = ing.qty;
      const scaledQty =
        qty === null || qty === undefined ? null : round3(Number(qty) * factor);
      const substitutes = (ing.substitutes as Record<string, unknown>[] | undefined)?.map(
        (sub) => ({
          ...sub,
          qty:
            sub.qty === null || sub.qty === undefined
              ? null
              : round3(Number(sub.qty) * factor),
        })
      );
      return { ...ing, qty: scaledQty, substitutes: substitutes ?? [] };
    });

    return NextResponse.json({
      data: {
        ...dto,
        ingredients: scaledIngredients,
        // steps/media/variants — без изменений (dto уже содержит их как есть)
      },
      meta: {
        servings,
        base_servings: baseServings,
        factor,
        access_level: access.level,
        access_reason: access.reason,
        display_only: true, // пересчёт не записывается в БД
      },
    });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes/[id]/scale",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}
