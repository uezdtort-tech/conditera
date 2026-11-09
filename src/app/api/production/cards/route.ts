/**
 * /api/production/cards — производственные карты кондитера (RECIPE-05, §F.9-F.10).
 *
 * POST — создать карту (status='draft') с нормами сырья.
 * GET  — список карт: владелец видит свои (с нормами), ADMIN/SUPER_ADMIN —
 *        все (чужие — метаданные, БЕЗ норм/цен: Ф «видимость себестоимости»).
 *
 * Роли (ПР-6): CONFECTIONER-семейство + ADMIN/SUPER_ADMIN; SUPPLIER → 403.
 *
 * Валидация POST (RB.14):
 *   • recipe_id существует; recipe_version_id (опц.) принадлежит рецепту —
 *     «норма фиксируется на версии»;
 *   • inventory_item_id (когда задан) принадлежит складу ВЛАДЕЛЬЦА
 *     (склад owner-only, миграция 0010) — чужая позиция → 422;
 *   • частичный UNIQUE(owner_id, product_id) (0070:41-43) — конфликт → 409;
 *   • нормы: 1..200, qty_per_unit > 0, unit обязателен.
 *
 * Атомарность: вставка карты → вставка норм; при ошибке детей карта удаляется
 * (компенсация; настоящих транзакций в PostgREST-шим нет — RB.14).
 *
 * Схема: recipe_production_cards / recipe_production_ingredients (0070),
 * запись через supabaseAdmin (service_role) — RB.16.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import {
  isAdminRole,
  isSupplierRole,
  hasProductionRole,
  isUuid,
  parsePositiveNumber,
  parseNonNegativeInt,
  parseCanonicalPlannedUnit,
  parseCardNormsInput,
  findForeignInventoryItems,
  serializeCard,
  serializeIngredient,
  type CardIngredientRow,
  type CardRow,
} from "@/lib/recipes/production";

export const runtime = "nodejs";

const TITLE_MAX = 200;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ============================================================================
// POST /api/production/cards — создать черновик карты
// ============================================================================
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    // ПР-6: SUPPLIER не допускается в производственный контур
    if (isSupplierRole(user.roles)) {
      return NextResponse.json(
        { error: "Роль SUPPLIER не имеет доступа к производственному контуру" },
        { status: 403 }
      );
    }
    if (!hasProductionRole(user.roles)) {
      return NextResponse.json({ error: "Недостаточно прав для создания карт" }, { status: 403 });
    }

    const rl = await rateLimit({ key: `prod-cards-post:${user.id}`, limit: 30, windowMs: 60_000 });
    if (!rl.success) {
      return NextResponse.json(
        { error: "Слишком много запросов, попробуйте позже" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
    }

    // --- recipe_id (обязателен, существует) ---
    const recipeId = isUuid(body.recipe_id) ? (body.recipe_id as string).trim() : null;
    if (!recipeId) {
      return NextResponse.json({ error: "recipe_id обязателен (uuid)" }, { status: 422 });
    }
    const { data: recipe, error: recipeErr } = await supabaseAdmin
      .from("recipes")
      .select("id")
      .eq("id", recipeId)
      .maybeSingle();
    if (recipeErr) {
      console.error("[production/cards] recipe lookup failed:", recipeErr.message);
      return NextResponse.json({ error: "Ошибка проверки рецепта" }, { status: 500 });
    }
    if (!recipe) {
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 422 });
    }

    // --- recipe_version_id (опционален; принадлежит рецепту) ---
    const recipeVersionId = isUuid(body.recipe_version_id)
      ? (body.recipe_version_id as string).trim()
      : null;
    if (recipeVersionId) {
      const { data: ver, error: verErr } = await supabaseAdmin
        .from("recipe_versions")
        .select("id, recipe_id")
        .eq("id", recipeVersionId)
        .maybeSingle();
      if (verErr) {
        console.error("[production/cards] recipe_version lookup failed:", verErr.message);
        return NextResponse.json({ error: "Ошибка проверки версии рецепта" }, { status: 500 });
      }
      if (!ver || (ver as { recipe_id: string }).recipe_id !== recipeId) {
        return NextResponse.json(
          { error: "Версия рецепта не найдена или не принадлежит рецепту" },
          { status: 422 }
        );
      }
    }

    // --- title ---
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, TITLE_MAX)
        : null;
    if (!title) {
      return NextResponse.json({ error: "title обязателен (1..200 символов)" }, { status: 422 });
    }

    // --- product_id (опционален; 1:1 по частичному UNIQUE(owner,product)) ---
    const productId = isUuid(body.product_id) ? (body.product_id as string).trim() : null;
    if (productId) {
      const { data: dup, error: dupErr } = await supabaseAdmin
        .from("recipe_production_cards")
        .select("id")
        .eq("owner_id", user.id)
        .eq("product_id", productId)
        .maybeSingle();
      if (dupErr) {
        console.error("[production/cards] product uniqueness check failed:", dupErr.message);
        return NextResponse.json({ error: "Ошибка проверки товара" }, { status: 500 });
      }
      if (dup) {
        return NextResponse.json(
          { error: "Карта для этого товара уже существует (одна карта на товар)" },
          { status: 409 }
        );
      }
    }

    // --- batch_yield / portions_per_batch ---
    const batchYieldQty =
      body.batch_yield_qty === undefined || body.batch_yield_qty === null
        ? null
        : parsePositiveNumber(body.batch_yield_qty);
    if (body.batch_yield_qty !== undefined && body.batch_yield_qty !== null && batchYieldQty === null) {
      return NextResponse.json({ error: "batch_yield_qty должен быть числом > 0" }, { status: 422 });
    }
    // batch_yield_unit — канон г/мл/шт (как planned_unit, RA.11.1); NULL допустим
    const batchYieldUnitRaw =
      typeof body.batch_yield_unit === "string" && body.batch_yield_unit.trim()
        ? parseCanonicalPlannedUnit(body.batch_yield_unit)
        : null;
    if (
      typeof body.batch_yield_unit === "string" &&
      body.batch_yield_unit.trim() &&
      !batchYieldUnitRaw
    ) {
      return NextResponse.json(
        { error: "batch_yield_unit должен быть канонической единицей (г/мл/шт)" },
        { status: 422 }
      );
    }
    const batchYieldUnit = batchYieldUnitRaw;
    const portionsPerBatch =
      body.portions_per_batch === undefined || body.portions_per_batch === null
        ? null
        : parseNonNegativeInt(body.portions_per_batch);
    if (
      body.portions_per_batch !== undefined &&
      body.portions_per_batch !== null &&
      portionsPerBatch === null
    ) {
      return NextResponse.json(
        { error: "portions_per_batch должен быть целым числом ≥ 0" },
        { status: 422 }
      );
    }

    // --- нормы ---
    const parsedNorms = parseCardNormsInput(body.norms);
    if ("error" in parsedNorms) {
      return NextResponse.json({ error: parsedNorms.error }, { status: 422 });
    }
    const norms = parsedNorms.norms;

    // --- склад: inventory_item_id должен принадлежать ВЛАДЕЛЬЦУ (0010, owner-only) ---
    const foreign = await findForeignInventoryItems(norms, user.id);
    if (foreign.length > 0) {
      return NextResponse.json(
        {
          error: "Складские позиции не найдены или не принадлежат вам",
          inventory_item_ids: foreign,
        },
        { status: 422 }
      );
    }

    // --- INSERT карты (status='draft') ---
    const { data: card, error: cardErr } = await supabaseAdmin
      .from("recipe_production_cards")
      .insert({
        owner_id: user.id, // owner_id задаёт СЕРВЕР (не клиент)
        recipe_id: recipeId,
        recipe_version_id: recipeVersionId,
        product_id: productId,
        title,
        status: "draft",
        batch_yield_qty: batchYieldQty,
        batch_yield_unit: batchYieldUnit,
        portions_per_batch: portionsPerBatch,
      })
      .select("*")
      .single();
    if (cardErr || !card) {
      // 23505 — гонка на частичном UNIQUE(owner,product): чистый 409
      if ((cardErr as { code?: string } | null)?.code === "23505") {
        return NextResponse.json(
          { error: "Карта для этого товара уже существует (одна карта на товар)" },
          { status: 409 }
        );
      }
      console.error("[production/cards] insert failed:", cardErr?.message);
      return NextResponse.json({ error: "Не удалось создать карту" }, { status: 500 });
    }
    const cardRow = card as unknown as CardRow;

    // --- INSERT норм; при ошибке детей — компенсирующее удаление карты ---
    const ingredientRows = norms.map((n) => ({
      card_id: cardRow.id,
      source_ingredient_id: n.source_ingredient_id,
      inventory_item_id: n.inventory_item_id,
      qty_per_unit: n.qty_per_unit,
      qty_per_batch: n.qty_per_batch,
      unit: n.unit,
      brutto_qty: n.brutto_qty,
      waste_pct: n.waste_pct,
      is_optional: n.is_optional,
    }));
    const { data: insertedIngredients, error: ingErr } = await supabaseAdmin
      .from("recipe_production_ingredients")
      .insert(ingredientRows)
      .select("*");
    if (ingErr || !insertedIngredients) {
      console.error("[production/cards] ingredients insert failed:", ingErr?.message);
      // Атомарность (RB.14): карта без норм не должна остаться
      await supabaseAdmin.from("recipe_production_cards").delete().eq("id", cardRow.id);
      return NextResponse.json({ error: "Не удалось сохранить нормы карты" }, { status: 500 });
    }

    return NextResponse.json(
      {
        card: serializeCard(cardRow, { isOwner: true, latestVersionNo: null }),
        ingredients: (insertedIngredients as unknown as CardIngredientRow[]).map(serializeIngredient),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[production/cards] POST error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

// ============================================================================
// GET /api/production/cards — список карт (свои; ADMIN — все)
// Query: status, recipe_id, product_id, owner_id (только ADMIN), limit, offset
// ============================================================================
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const rl = await rateLimit({ key: `prod-cards-get:${user.id}`, limit: 120, windowMs: 60_000 });
    if (!rl.success) {
      return NextResponse.json(
        { error: "Слишком много запросов, попробуйте позже" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const admin = isAdminRole(user.roles);
    const ownerFilter = searchParams.get("owner_id");
    const status = searchParams.get("status");
    const recipeId = searchParams.get("recipe_id");
    const productId = searchParams.get("product_id");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    // Владелец видит свои карты; ADMIN — все (опционально с фильтром owner_id)
    let query = supabaseAdmin
      .from("recipe_production_cards")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (!admin) {
      query = query.eq("owner_id", user.id);
    } else if (ownerFilter && isUuid(ownerFilter)) {
      query = query.eq("owner_id", ownerFilter.trim());
    }
    if (status && ["draft", "approved", "archived"].includes(status)) {
      query = query.eq("status", status);
    }
    if (recipeId && isUuid(recipeId)) {
      query = query.eq("recipe_id", recipeId.trim());
    }
    if (productId && isUuid(productId)) {
      query = query.eq("product_id", productId.trim());
    }

    const { data: cards, error, count } = await query;
    if (error) {
      console.error("[production/cards] GET failed:", error.message);
      return NextResponse.json({ error: "Не удалось получить карты" }, { status: 500 });
    }
    const rows = (cards ?? []) as unknown as CardRow[];

    // Последние версии карт (для списка; SELECT-only RLS, чтение через service_role)
    const latestVersions = new Map<string, number>();
    const latestVersionIds = new Map<string, string>();
    if (rows.length > 0) {
      const { data: vers, error: versErr } = await supabaseAdmin
        .from("recipe_production_card_versions")
        .select("id, card_id, version_no")
        .in(
          "card_id",
          rows.map((r) => r.id)
        )
        .order("version_no", { ascending: false });
      if (!versErr) {
        for (const v of (vers ?? []) as Array<{ id: string; card_id: string; version_no: number }>) {
          if (!latestVersions.has(v.card_id)) {
            latestVersions.set(v.card_id, Number(v.version_no));
            latestVersionIds.set(v.card_id, String(v.id));
          }
        }
      }
    }

    // Нормы включаются ТОЛЬКО для своих карт (Ф «видимость себестоимости»)
    const ownIds = rows.filter((r) => r.owner_id === user.id).map((r) => r.id);
    const ingredientsByCard = new Map<string, CardIngredientRow[]>();
    if (ownIds.length > 0) {
      const { data: ings, error: ingErr } = await supabaseAdmin
        .from("recipe_production_ingredients")
        .select("*")
        .in("card_id", ownIds);
      if (!ingErr) {
        for (const ing of (ings ?? []) as unknown as CardIngredientRow[]) {
          const list = ingredientsByCard.get(ing.card_id) ?? [];
          list.push(ing);
          ingredientsByCard.set(ing.card_id, list);
        }
      }
    }

    return NextResponse.json({
      cards: rows.map((r) => {
        const isOwner = r.owner_id === user.id;
        const serialized = serializeCard(r, {
          isOwner,
          latestVersionNo: latestVersions.get(r.id) ?? null,
          latestVersionId: latestVersionIds.get(r.id) ?? null,
        });
        if (isOwner) {
          serialized.ingredients = (ingredientsByCard.get(r.id) ?? []).map(serializeIngredient);
        }
        return serialized;
      }),
      total: count ?? rows.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[production/cards] GET error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
