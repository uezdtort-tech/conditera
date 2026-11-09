/**
 * /api/production/cards/[id] — редактирование производственной карты (RECIPE-05).
 *
 * PATCH — только ВЛАДЕЛЕЦ карты (RB.14/RB.15):
 *   • контент (title, recipe_version_id, product_id, batch_yield_qty/unit,
 *     portions_per_batch, norms) правится ТОЛЬКО в status='draft';
 *   • переходы статусов: approved→draft (правки), archived→draft,
 *     draft→archived, approved→archived; статус 'approved' через PATCH
 *     ЗАПРЕЩЁН — утверждение только через POST /approve (RB.15);
 *   • правка после approve возвращает карту в draft; существующие версии и
 *     история себестоимости НЕ переписываются (иммутабельность версий, RB.16).
 *
 * Замена норм: DELETE старых детей + INSERT новых; при ошибке вставки старые
 * нормы восстанавливаются (компенсация — PostgREST-шим без транзакций).
 *
 * Схема: recipe_production_cards / recipe_production_ingredients (0070).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import {
  isUuid,
  parsePositiveNumber,
  parseNonNegativeInt,
  parseCanonicalPlannedUnit,
  parseCardNormsInput,
  findForeignInventoryItems,
  loadCardWithLatestVersion,
  serializeCard,
  serializeIngredient,
  type CardIngredientRow,
  type CardRow,
  type NormInput,
} from "@/lib/recipes/production";

export const runtime = "nodejs";

const TITLE_MAX = 200;

interface CardPatchBody {
  title?: unknown;
  recipe_version_id?: unknown;
  product_id?: unknown;
  batch_yield_qty?: unknown;
  batch_yield_unit?: unknown;
  portions_per_batch?: unknown;
  status?: unknown;
  norms?: unknown;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const rl = await rateLimit({ key: `prod-card-patch:${user.id}`, limit: 60, windowMs: 60_000 });
    if (!rl.success) {
      return NextResponse.json(
        { error: "Слишком много запросов, попробуйте позже" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "id должен быть uuid" }, { status: 400 });
    }

    const loaded = await loadCardWithLatestVersion(id.trim());
    if (!loaded) {
      return NextResponse.json({ error: "Карта не найдена" }, { status: 404 });
    }
    const card = loaded.card;

    // Только владелец карты (RB.14: ownership); ADMIN чужие карты не правит
    if (card.owner_id !== user.id) {
      return NextResponse.json({ error: "Доступ только у владельца карты" }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as CardPatchBody | null;
    if (!body) {
      return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
    }

    const hasContentEdits =
      body.title !== undefined ||
      body.recipe_version_id !== undefined ||
      body.product_id !== undefined ||
      body.batch_yield_qty !== undefined ||
      body.batch_yield_unit !== undefined ||
      body.portions_per_batch !== undefined ||
      body.norms !== undefined;

    // --- Статусные переходы (RB.15: draft → approved → archived; approved → draft) ---
    let nextStatus = card.status;
    if (body.status !== undefined) {
      const requested = typeof body.status === "string" ? body.status.trim() : null;
      if (!requested || !["draft", "approved", "archived"].includes(requested)) {
        return NextResponse.json(
          { error: "status должен быть одним из: draft | approved | archived" },
          { status: 422 }
        );
      }
      if (requested === "approved") {
        // Утверждение — отдельный эндпоинт с гейтом норм и созданием версии
        return NextResponse.json(
          { error: "Утверждение карты выполняется через POST /approve" },
          { status: 409 }
        );
      }
      if (requested === "draft") {
        // возврат в draft: разрешён из approved/archived (правка после approve)
        nextStatus = "draft";
      } else if (requested === "archived") {
        if (card.status === "archived") {
          nextStatus = "archived"; // no-op
        } else {
          nextStatus = "archived"; // draft/approved → archived
        }
      }
    }

    // --- Контент правится только в draft (RB.15) ---
    const effectiveStatus = nextStatus;
    if (hasContentEdits && effectiveStatus !== "draft") {
      return NextResponse.json(
        {
          error:
            "Правка содержимого разрешена только в черновике — верните карту в draft (status: 'draft')",
        },
        { status: 409 }
      );
    }

    const updates: Record<string, unknown> = { status: nextStatus };

    // --- title ---
    if (body.title !== undefined) {
      const title =
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim().slice(0, TITLE_MAX)
          : null;
      if (!title) {
        return NextResponse.json({ error: "title обязателен (1..200 символов)" }, { status: 422 });
      }
      updates.title = title;
    }

    // --- recipe_version_id (принадлежит рецепту карты) ---
    if (body.recipe_version_id !== undefined) {
      if (body.recipe_version_id === null) {
        updates.recipe_version_id = null;
      } else if (isUuid(body.recipe_version_id)) {
        const rvId = (body.recipe_version_id as string).trim();
        const { data: ver, error: verErr } = await supabaseAdmin
          .from("recipe_versions")
          .select("id, recipe_id")
          .eq("id", rvId)
          .maybeSingle();
        if (verErr) {
          console.error("[production/cards/id] version lookup failed:", verErr.message);
          return NextResponse.json({ error: "Ошибка проверки версии рецепта" }, { status: 500 });
        }
        if (!ver || (ver as { recipe_id: string }).recipe_id !== card.recipe_id) {
          return NextResponse.json(
            { error: "Версия рецепта не найдена или не принадлежит рецепту карты" },
            { status: 422 }
          );
        }
        updates.recipe_version_id = rvId;
      } else {
        return NextResponse.json({ error: "recipe_version_id должен быть uuid или null" }, { status: 422 });
      }
    }

    // --- product_id (частичный UNIQUE(owner,product), 0070:41-43) ---
    if (body.product_id !== undefined) {
      if (body.product_id === null) {
        updates.product_id = null;
      } else if (isUuid(body.product_id)) {
        const productId = (body.product_id as string).trim();
        const { data: dup, error: dupErr } = await supabaseAdmin
          .from("recipe_production_cards")
          .select("id")
          .eq("owner_id", card.owner_id)
          .eq("product_id", productId)
          .neq("id", card.id)
          .maybeSingle();
        if (dupErr) {
          console.error("[production/cards/id] product uniqueness check failed:", dupErr.message);
          return NextResponse.json({ error: "Ошибка проверки товара" }, { status: 500 });
        }
        if (dup) {
          return NextResponse.json(
            { error: "Карта для этого товара уже существует (одна карта на товар)" },
            { status: 409 }
          );
        }
        updates.product_id = productId;
      } else {
        return NextResponse.json({ error: "product_id должен быть uuid или null" }, { status: 422 });
      }
    }

    // --- batch_yield / portions_per_batch ---
    if (body.batch_yield_qty !== undefined) {
      if (body.batch_yield_qty === null) {
        updates.batch_yield_qty = null;
      } else {
        const v = parsePositiveNumber(body.batch_yield_qty);
        if (v === null) {
          return NextResponse.json({ error: "batch_yield_qty должен быть числом > 0" }, { status: 422 });
        }
        updates.batch_yield_qty = v;
      }
    }
    if (body.batch_yield_unit !== undefined) {
      if (body.batch_yield_unit === null) {
        updates.batch_yield_unit = null;
      } else {
        const u = parseCanonicalPlannedUnit(body.batch_yield_unit);
        if (!u) {
          return NextResponse.json(
            { error: "batch_yield_unit должен быть канонической единицей (г/мл/шт)" },
            { status: 422 }
          );
        }
        updates.batch_yield_unit = u;
      }
    }
    if (body.portions_per_batch !== undefined) {
      if (body.portions_per_batch === null) {
        updates.portions_per_batch = null;
      } else {
        const v = parseNonNegativeInt(body.portions_per_batch);
        if (v === null) {
          return NextResponse.json(
            { error: "portions_per_batch должен быть целым числом ≥ 0" },
            { status: 422 }
          );
        }
        updates.portions_per_batch = v;
      }
    }

    // --- Замена норм (только draft; checked выше) ---
    let replacementNorms: NormInput[] | null = null;
    if (body.norms !== undefined) {
      const parsed = parseCardNormsInput(body.norms);
      if ("error" in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 422 });
      }
      const foreign = await findForeignInventoryItems(parsed.norms, card.owner_id);
      if (foreign.length > 0) {
        return NextResponse.json(
          {
            error: "Складские позиции не найдены или не принадлежат вам",
            inventory_item_ids: foreign,
          },
          { status: 422 }
        );
      }
      replacementNorms = parsed.norms;
    }

    // --- Применяем изменения корня карты ---
    const { data: updatedCard, error: updErr } = await supabaseAdmin
      .from("recipe_production_cards")
      .update(updates)
      .eq("id", card.id)
      .select("*")
      .single();
    if (updErr || !updatedCard) {
      console.error("[production/cards/id] update failed:", updErr?.message);
      return NextResponse.json({ error: "Не удалось обновить карту" }, { status: 500 });
    }

    // --- Замена норм: DELETE → INSERT (компенсация при сбое) ---
    let ingredients: CardIngredientRow[] | null = null;
    if (replacementNorms) {
      const { data: oldIngredients, error: loadOldErr } = await supabaseAdmin
        .from("recipe_production_ingredients")
        .select("*")
        .eq("card_id", card.id);
      if (loadOldErr) {
        console.error("[production/cards/id] load old ingredients failed:", loadOldErr.message);
        return NextResponse.json({ error: "Не удалось заменить нормы" }, { status: 500 });
      }
      const oldRows = (oldIngredients ?? []) as unknown as CardIngredientRow[];

      const { error: delErr } = await supabaseAdmin
        .from("recipe_production_ingredients")
        .delete()
        .eq("card_id", card.id);
      if (delErr) {
        console.error("[production/cards/id] delete old ingredients failed:", delErr.message);
        return NextResponse.json({ error: "Не удалось заменить нормы" }, { status: 500 });
      }

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("recipe_production_ingredients")
        .insert(
          replacementNorms.map((n) => ({
            card_id: card.id,
            source_ingredient_id: n.source_ingredient_id,
            inventory_item_id: n.inventory_item_id,
            qty_per_unit: n.qty_per_unit,
            qty_per_batch: n.qty_per_batch,
            unit: n.unit,
            brutto_qty: n.brutto_qty,
            waste_pct: n.waste_pct,
            is_optional: n.is_optional,
          }))
        )
        .select("*");
      if (insErr || !inserted) {
        console.error("[production/cards/id] insert new ingredients failed:", insErr?.message);
        // Компенсация: восстанавливаем старые нормы (карта не остаётся без состава)
        if (oldRows.length > 0) {
          await supabaseAdmin.from("recipe_production_ingredients").insert(
            oldRows.map((o) => ({
              card_id: o.card_id,
              source_ingredient_id: o.source_ingredient_id,
              inventory_item_id: o.inventory_item_id,
              qty_per_unit: o.qty_per_unit,
              qty_per_batch: o.qty_per_batch,
              unit: o.unit,
              brutto_qty: o.brutto_qty,
              waste_pct: o.waste_pct,
              is_optional: o.is_optional,
            }))
          );
        }
        return NextResponse.json({ error: "Не удалось сохранить нормы карты" }, { status: 500 });
      }
      ingredients = inserted as unknown as CardIngredientRow[];
    }

    // --- Нормы после операции (если замены не было — читаем текущие) ---
    if (!ingredients) {
      const { data: current, error: curErr } = await supabaseAdmin
        .from("recipe_production_ingredients")
        .select("*")
        .eq("card_id", card.id);
      if (!curErr) ingredients = (current ?? []) as unknown as CardIngredientRow[];
    }

    return NextResponse.json({
      card: serializeCard(updatedCard as unknown as CardRow, {
        isOwner: true,
        latestVersionNo: loaded.latestVersionNo,
        latestVersionId: loaded.latestVersionId,
      }),
      ingredients: (ingredients ?? []).map(serializeIngredient),
    });
  } catch (error) {
    console.error("[production/cards/id] PATCH error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

// ============================================================================
// GET /api/production/cards/[id] — одна карта (нормы — только владельцу)
// ============================================================================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "id должен быть uuid" }, { status: 400 });
    }

    const loaded = await loadCardWithLatestVersion(id.trim());
    if (!loaded) {
      return NextResponse.json({ error: "Карта не найдена" }, { status: 404 });
    }
    const card = loaded.card;
    const isOwner = card.owner_id === user.id;
    // Чужая карта: владелец или ADMIN (RLS-модель RB.16 owner/ADMIN)
    if (!isOwner) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("is_active", true);
      const isAdmin = (roles ?? []).some((r) =>
        ["ADMIN", "SUPER_ADMIN"].includes((r as { role: string }).role)
      );
      if (!isAdmin) {
        return NextResponse.json({ error: "Карта доступна только владельцу" }, { status: 403 });
      }
    }

    const serialized = serializeCard(card, {
      isOwner,
      latestVersionNo: loaded.latestVersionNo,
      latestVersionId: loaded.latestVersionId,
    });
    if (isOwner) {
      const { data: ings, error: ingErr } = await supabaseAdmin
        .from("recipe_production_ingredients")
        .select("*")
        .eq("card_id", card.id);
      if (!ingErr) {
        serialized.ingredients = ((ings ?? []) as unknown as CardIngredientRow[]).map(
          serializeIngredient
        );
      }
    }

    return NextResponse.json({ card: serialized });
  } catch (error) {
    console.error("[production/cards/id] GET error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
