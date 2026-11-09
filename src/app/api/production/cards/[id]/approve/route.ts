/**
 * /api/production/cards/[id]/approve — утверждение производственной карты
 * (RECIPE-05, RB.14/RB.15 спеки RECIPE_01_AUDIT_AND_TARGET_ARCHITECTURE.md).
 *
 * POST — только ВЛАДЕЛЕЦ карты.
 *
 * Гейт (RB.15: «approve при непривязанных нормах — запрещён»):
 *   • нормы непустые;
 *   • ВСЕ нормы имеют inventory_item_id NOT NULL → иначе 422 «нормы без привязок».
 *
 * Атомарная связка (один бизнес-акт, RB.14 «создание card_version + history
 * в одной транзакции»; компенсации — PostgREST-шим без настоящих транзакций):
 *   1. INSERT recipe_production_card_versions (version_no = max+1,
 *      snapshot = полный снапшот корня карты + норм + цен на момент,
 *      approved_by) — мутационных RLS-политик у таблицы нет, запись только
 *      через service_role (RB.16);
 *   2. INSERT recipe_card_cost_history — калькуляция ЕДИНЫМ серверным
 *      калькулятором src/lib/recipes/cost.ts (RA.12), цены читаются СЕРВЕРНО
 *      из inventory_items.cost_per_unit (клиентские цены не принимаются),
 *      price_basis='inventory_current', computed_at=now — история НЕ
 *      пересчитывается задним числом (RA.12.1, сценарий приёмки №13);
 *   3. UPDATE карты: status='approved', approved_by, approved_at,
 *      recipe_version_id (если был NULL и задан в теле).
 *
 * Идемпотентность (RB.14): повторный approve БЕЗ правок контента → 200
 * {cardVersionNo: существующий, idempotent: true}; правки (PATCH → draft,
 * новая approve) создают НОВУЮ версию (version_no+1).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { calcCardCost, type CardNormSnapshot, type InventoryPrice } from "@/lib/recipes/cost";
import {
  isUuid,
  loadCardWithLatestVersion,
  buildCardSnapshot,
  canonicalJson,
  type CardIngredientRow,
  type CardRow,
} from "@/lib/recipes/production";

export const runtime = "nodejs";

/**
 * Проекция контента для сравнения «без правок»: корень карты (без статусных/
 * служебных полей) + нормы. Цены/себестоимость намеренно НЕ входят — повторный
 * approve без правок норм идемпотентен даже при изменившихся складских ценах
 * (RB.14: «повтор → та же версия»); свежая калькуляция выполняется только
 * при новой версии или явном recompute.
 */
function contentProjection(card: CardRow, ingredients: CardIngredientRow[]) {
  return {
    card: {
      recipe_id: card.recipe_id,
      recipe_version_id: card.recipe_version_id,
      product_id: card.product_id,
      title: card.title,
      batch_yield_qty: card.batch_yield_qty === null ? null : Number(card.batch_yield_qty),
      batch_yield_unit: card.batch_yield_unit,
      portions_per_batch: card.portions_per_batch,
    },
    ingredients: ingredients
      .map((i) => ({
        source_ingredient_id: i.source_ingredient_id,
        inventory_item_id: i.inventory_item_id,
        qty_per_unit: Number(i.qty_per_unit),
        qty_per_batch: i.qty_per_batch === null ? null : Number(i.qty_per_batch),
        unit: i.unit,
        brutto_qty: i.brutto_qty === null ? null : Number(i.brutto_qty),
        waste_pct: i.waste_pct === null ? null : Number(i.waste_pct),
        is_optional: i.is_optional === true,
      }))
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
  };
}

/** Серверные цены позиций склада (клиентские цены не принимаются — RA.12) */
async function loadInventoryPrices(itemIds: string[]): Promise<InventoryPrice[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("inventory_items")
    .select("id, name, unit, cost_per_unit")
    .in("id", itemIds);
  if (error) throw new Error(`inventory prices load failed: ${error.message}`);
  return (data ?? []) as unknown as InventoryPrice[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const rl = await rateLimit({ key: `prod-card-approve:${user.id}`, limit: 30, windowMs: 60_000 });
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

    // Только владелец карты (RB.14); ADMIN чужие карты не утверждает
    if (card.owner_id !== user.id) {
      return NextResponse.json({ error: "Утвердить карту может только владелец" }, { status: 403 });
    }

    // archived → approve запрещён (RB.15: archived → draft → approved)
    if (card.status === "archived") {
      return NextResponse.json(
        { error: "Карта в архиве — верните её в draft перед утверждением" },
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    // recipe_version_id: если у карты NULL и задан в теле — фиксируем на версии
    let recipeVersionId = card.recipe_version_id;
    if (!recipeVersionId && body && isUuid(body.recipe_version_id)) {
      const rvId = (body.recipe_version_id as string).trim();
      const { data: ver, error: verErr } = await supabaseAdmin
        .from("recipe_versions")
        .select("id, recipe_id")
        .eq("id", rvId)
        .maybeSingle();
      if (verErr) {
        console.error("[production/cards/approve] version lookup failed:", verErr.message);
        return NextResponse.json({ error: "Ошибка проверки версии рецепта" }, { status: 500 });
      }
      if (!ver || (ver as { recipe_id: string }).recipe_id !== card.recipe_id) {
        return NextResponse.json(
          { error: "Версия рецепта не найдена или не принадлежит рецепту карты" },
          { status: 422 }
        );
      }
      recipeVersionId = rvId;
    }

    // --- Нормы карты ---
    const { data: ingRows, error: ingErr } = await supabaseAdmin
      .from("recipe_production_ingredients")
      .select("*")
      .eq("card_id", card.id);
    if (ingErr) {
      console.error("[production/cards/approve] ingredients load failed:", ingErr.message);
      return NextResponse.json({ error: "Не удалось загрузить нормы карты" }, { status: 500 });
    }
    const ingredients = (ingRows ?? []) as unknown as CardIngredientRow[];

    // ГЕЙТ approve (RB.15): нормы непустые и ВСЕ привязаны к складу
    if (ingredients.length === 0) {
      return NextResponse.json(
        { error: "Карта без норм не может быть утверждена" },
        { status: 422 }
      );
    }
    const unbound = ingredients.filter((i) => !i.inventory_item_id);
    if (unbound.length > 0) {
      return NextResponse.json(
        {
          error: "нормы без привязок: утверждение запрещено, пока все нормы не привязаны к складу",
          unbound_ingredient_ids: unbound.map((i) => i.id),
        },
        { status: 422 }
      );
    }

    // --- Серверные цены (inventory_items.cost_per_unit, целые рубли — Ф-20) ---
    const itemIds = [...new Set(ingredients.map((i) => i.inventory_item_id as string))];
    let prices: InventoryPrice[];
    try {
      prices = await loadInventoryPrices(itemIds);
    } catch (e) {
      console.error("[production/cards/approve]", (e as Error).message);
      return NextResponse.json({ error: "Не удалось получить цены склада" }, { status: 500 });
    }
    const priceById = new Map(prices.map((p) => [p.id, p]));
    const missing = itemIds.filter((iid) => !priceById.has(iid));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: "Складские позиции норм не найдены", inventory_item_ids: missing },
        { status: 422 }
      );
    }

    // --- Единый серверный калькулятор (RA.12) ---
    const normSnapshot: CardNormSnapshot[] = ingredients.map((i) => ({
      inventory_item_id: i.inventory_item_id,
      qty_per_unit: Number(i.qty_per_unit),
      qty_per_batch: i.qty_per_batch === null ? null : Number(i.qty_per_batch),
      unit: i.unit,
      brutto_qty: i.brutto_qty === null ? null : Number(i.brutto_qty),
      waste_pct: i.waste_pct === null ? null : Number(i.waste_pct),
      is_optional: i.is_optional === true,
    }));
    const cost = calcCardCost(normSnapshot, prices, {
      portionsPerBatch: card.portions_per_batch,
      batchYieldQty: card.batch_yield_qty === null ? null : Number(card.batch_yield_qty),
      batchYieldUnit: card.batch_yield_unit,
    });

    // --- Идемпотентность: повторный approve без правок → та же версия (RB.14) ---
    if (loaded.latestVersionNo !== null) {
      const { data: latestVer, error: latestErr } = await supabaseAdmin
        .from("recipe_production_card_versions")
        .select("id, version_no, snapshot")
        .eq("card_id", card.id)
        .eq("version_no", loaded.latestVersionNo)
        .maybeSingle();
      if (latestErr) {
        console.error("[production/cards/approve] latest version load failed:", latestErr.message);
        return NextResponse.json({ error: "Ошибка проверки версии карты" }, { status: 500 });
      }
      const snapshot = (latestVer?.snapshot ?? null) as
        | { content?: unknown; [k: string]: unknown }
        | null;
      if (latestVer && snapshot && snapshot.content) {
        const currentContent = contentProjection(
          { ...card, recipe_version_id: recipeVersionId },
          ingredients
        );
        if (canonicalJson(snapshot.content) === canonicalJson(currentContent)) {
          // Идемпотентный replay: карта могла быть возвращена в draft —
          // восстанавливаем approved-статус без создания новой версии
          if (card.status !== "approved") {
            const { error: updErr } = await supabaseAdmin
              .from("recipe_production_cards")
              .update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() })
              .eq("id", card.id);
            if (updErr) {
              console.error("[production/cards/approve] status restore failed:", updErr.message);
              return NextResponse.json({ error: "Не удалось обновить статус карты" }, { status: 500 });
            }
          }
          const { data: hist } = await supabaseAdmin
            .from("recipe_card_cost_history")
            .select("cost_per_unit_rub, cost_per_batch_rub, computed_at")
            .eq("card_version_id", (latestVer as { id: string }).id)
            .order("computed_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return NextResponse.json(
            {
              idempotent: true,
              cardVersionNo: Number((latestVer as { version_no: number }).version_no),
              cardVersionId: (latestVer as { id: string }).id,
              cost: hist
                ? {
                    cost_per_unit_rub: Number((hist as { cost_per_unit_rub: number }).cost_per_unit_rub),
                    cost_per_batch_rub: Number(
                      (hist as { cost_per_batch_rub: number }).cost_per_batch_rub
                    ),
                    computed_at: (hist as { computed_at: string }).computed_at,
                  }
                : null,
              message: "Карта без изменений — утверждение вернуло существующую версию",
            },
            { status: 200 }
          );
        }
      }
    }

    // --- Новая версия: version_no = max+1, снапшот = контент + цены на момент ---
    const nowIso = new Date().toISOString();
    const nextVersionNo = (loaded.latestVersionNo ?? 0) + 1;
    const snapshot = {
      ...buildCardSnapshot(
        { ...card, recipe_version_id: recipeVersionId, status: "approved" },
        ingredients,
        nowIso
      ),
      // Контент отдельно — для идемпотентного сравнения последующих approve
      content: contentProjection({ ...card, recipe_version_id: recipeVersionId }, ingredients),
      cost: {
        cost_per_unit_rub: cost.costPerUnitRub,
        cost_per_batch_rub: cost.costPerBatchRub,
        price_basis: "inventory_current" as const,
        breakdown: cost.breakdown,
      },
    };

    const { data: version, error: verInsErr } = await supabaseAdmin
      .from("recipe_production_card_versions")
      .insert({
        card_id: card.id,
        version_no: nextVersionNo,
        snapshot,
        approved_by: user.id,
        approved_at: nowIso,
      })
      .select("id, version_no")
      .single();
    if (verInsErr || !version) {
      // 23505 — конкурентный approve успел первым: пере-читываем его версию
      if ((verInsErr as { code?: string } | null)?.code === "23505") {
        const raced = await loadCardWithLatestVersion(card.id);
        if (raced?.latestVersionNo) {
          return NextResponse.json(
            {
              idempotent: true,
              cardVersionNo: raced.latestVersionNo,
              message: "Версия создана параллельным запросом",
            },
            { status: 200 }
          );
        }
      }
      console.error("[production/cards/approve] version insert failed:", verInsErr?.message);
      return NextResponse.json({ error: "Не удалось создать версию карты" }, { status: 500 });
    }
    const versionId = (version as unknown as { id: string }).id;

    // --- История себестоимости (фиксация цен на момент approve, RA.12.1) ---
    const { error: histErr } = await supabaseAdmin.from("recipe_card_cost_history").insert({
      card_id: card.id,
      card_version_id: versionId,
      computed_at: nowIso,
      cost_per_unit_rub: cost.costPerUnitRub,
      cost_per_batch_rub: cost.costPerBatchRub,
      breakdown: cost.breakdown,
      price_basis: "inventory_current",
      created_by: user.id,
    });
    if (histErr) {
      console.error("[production/cards/approve] history insert failed:", histErr.message);
      // Компенсация: версия без истории себестоимости не должна остаться
      await supabaseAdmin.from("recipe_production_card_versions").delete().eq("id", versionId);
      return NextResponse.json({ error: "Не удалось зафиксировать себестоимость" }, { status: 500 });
    }

    // --- Финализация карты: approved + approved_by/at + recipe_version_id ---
    const cardUpdates: Record<string, unknown> = {
      status: "approved",
      approved_by: user.id,
      approved_at: nowIso,
    };
    if (card.recipe_version_id === null && recipeVersionId) {
      cardUpdates.recipe_version_id = recipeVersionId;
    }
    const { error: cardUpdErr } = await supabaseAdmin
      .from("recipe_production_cards")
      .update(cardUpdates)
      .eq("id", card.id);
    if (cardUpdErr) {
      console.error("[production/cards/approve] card update failed:", cardUpdErr.message);
      // Компенсация: откатываем версию и историю
      await supabaseAdmin.from("recipe_card_cost_history").delete().eq("card_version_id", versionId);
      await supabaseAdmin.from("recipe_production_card_versions").delete().eq("id", versionId);
      return NextResponse.json({ error: "Не удалось утвердить карту" }, { status: 500 });
    }

    return NextResponse.json(
      {
        idempotent: false,
        cardVersionNo: nextVersionNo,
        cardVersionId: versionId,
        cost: {
          cost_per_unit_rub: cost.costPerUnitRub,
          cost_per_batch_rub: cost.costPerBatchRub,
          price_basis: "inventory_current",
          breakdown: cost.breakdown,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[production/cards/approve] POST error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
