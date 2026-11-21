/**
 * Recipe-driven inventory write-off for a production order.
 * Called when the confectioner confirms the "ingredients_prepared" stage.
 * The unique batch claim is persisted BEFORE any stock movement, so concurrent
 * requests cannot deduct the same recipe twice.
 */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyInventoryMovement, type InventoryActor } from "@/lib/inventory";
import { computeOrderBreakdown } from "@/lib/ops/breakdown";
import { convertQty } from "@/lib/ops/units";
import { loadOrderLite, canOperateOrder } from "@/lib/ops/order-access";

type AppliedItem = {
  item_id: string;
  item_name: string;
  movement_id: string;
  quantity: number;
  remaining: number;
  unit: string | null;
};
type FailedItem = { item_id: string; error: string };
type WriteOffItem = { item_id: string; quantity: number };

export type RecipeWriteOffResult =
  | { ok: true; applied: AppliedItem[]; failed: FailedItem[]; idempotent: boolean }
  | { ok: false; status: number; error: string; details?: unknown };

function signatureFor(items: WriteOffItem[]): string {
  const canonical = [...items]
    .map((item) => `${item.item_id}:${item.quantity}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

function movementError(error: { kind: string; available?: number }): { status: number; message: string } {
  if (error.kind === "insufficient") return { status: 409, message: `Недостаточно на складе: доступно ${error.available ?? 0}` };
  if (error.kind === "forbidden") return { status: 403, message: "Нет доступа к позиции склада" };
  if (error.kind === "not_found") return { status: 404, message: "Позиция склада не найдена" };
  return { status: 500, message: "Не удалось записать движение склада" };
}

export async function writeOffOrderRecipe(
  actor: InventoryActor,
  orderId: string,
): Promise<RecipeWriteOffResult> {
  const order = await loadOrderLite(orderId);
  if (!order) return { ok: false, status: 404, error: "Заказ не найден" };
  if (!(await canOperateOrder(order, actor.id))) {
    return { ok: false, status: 403, error: "Нет доступа к производству этого заказа" };
  }
  if (order.status !== "PREPARING") {
    return { ok: false, status: 409, error: "Списание возможно только во время производства" };
  }
  if (!order.confectioner_id) {
    return { ok: false, status: 409, error: "Для заказа не назначен кондитер — склад определить невозможно" };
  }

  // Дедупликация принадлежит владельцу склада, а не тому, кто нажал кнопку.
  const inventoryOwnerId = order.confectioner_id;
  let items: WriteOffItem[] = [];
  let previouslyApplied: AppliedItem[] = [];
  let signature = "";

  // Сначала ищем уже созданное recipe-списание. Это важно: после успешного
  // OUT остаток уменьшен и повторный расчёт breakdown иначе увидит shortage.
  const { data: priorRows, error: priorError } = await supabaseAdmin
    .from("inventory_write_offs")
    .select("signature, items, result")
    .eq("owner_id", inventoryOwnerId)
    .eq("order_id", orderId)
    // PostgREST JSONB @> для данного поля в runtime-схеме приводился
    // к jsonb[] и падал. JSON path equality даёт точный scalar-фильтр.
    .eq("result->>source", "recipe")
    .order("created_at", { ascending: false })
    .limit(1);
  if (priorError) {
    console.error("[recipe-writeoff] prior batch lookup failed:", priorError.message);
    return { ok: false, status: 503, error: "Не удалось проверить предыдущее списание" };
  }

  const prior = priorRows?.[0] as {
    signature: string;
    items: WriteOffItem[];
    result: { state?: string; source?: string; applied?: AppliedItem[]; failed?: FailedItem[] };
  } | undefined;

  if (prior) {
    const saved = prior.result;
    if (!Array.isArray(saved.applied) || !Array.isArray(saved.failed)) {
      return { ok: false, status: 409, error: "Списание уже выполняется; повторите позже" };
    }
    if (saved.failed.length === 0) {
      return { ok: true, applied: saved.applied, failed: [], idempotent: true };
    }
    // После частичного успеха повторяем только неуспешные позиции из исходного
    // снимка рецепта; уже списанные ингредиенты не рассчитываем/не списываем снова.
    const failedIds = new Set(saved.failed.map((item) => item.item_id));
    items = (prior.items ?? []).filter((item) => failedIds.has(item.item_id));
    previouslyApplied = saved.applied;
    signature = prior.signature;
  } else {
    const breakdown = await computeOrderBreakdown(orderId);
    if (!breakdown) return { ok: false, status: 404, error: "Не удалось рассчитать рецептуру заказа" };
    if (!breakdown.ingredients.length) {
      return { ok: false, status: 422, error: "У товаров заказа не настроены рецептуры с ингредиентами" };
    }
    if (!breakdown.can_produce) {
      return {
        ok: false,
        status: 409,
        error: "Недостаточно ингредиентов или несовместимые единицы измерения",
        details: { shortages: breakdown.shortages, ingredients: breakdown.ingredients },
      };
    }

    for (const ingredient of breakdown.ingredients) {
      if (!ingredient.inventory_item_id || !ingredient.warehouse_unit) {
        return {
          ok: false,
          status: 409,
          error: `Для ингредиента «${ingredient.name}» не настроена привязка к позиции склада`,
        };
      }
      const quantity = convertQty(ingredient.required, ingredient.unit, ingredient.warehouse_unit);
      if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
        return {
          ok: false,
          status: 409,
          error: `Невозможно преобразовать единицу ингредиента «${ingredient.name}» в единицу склада`,
        };
      }
      items.push({ item_id: ingredient.inventory_item_id, quantity });
    }

    signature = signatureFor(items);
    const { error: claimError } = await supabaseAdmin.from("inventory_write_offs").insert({
      owner_id: inventoryOwnerId,
      order_id: orderId,
      signature,
      items,
      result: { state: "processing", source: "recipe" },
    });
    if (claimError) {
      if ((claimError as { code?: string }).code !== "23505") {
        console.error("[recipe-writeoff] claim failed:", claimError.message);
        return { ok: false, status: 503, error: "Не удалось зарезервировать списание. Повторите позже." };
      }
      // Другая попытка могла успеть завершить тот же batch (включая ручной
      // UI-вызов с идентичным составом). Возвращаем результат, а не списываем снова.
      const { data: raced, error: racedError } = await supabaseAdmin
        .from("inventory_write_offs")
        .select("items, result")
        .eq("owner_id", inventoryOwnerId)
        .eq("order_id", orderId)
        .eq("signature", signature)
        .maybeSingle();
      if (racedError || !raced) {
        return { ok: false, status: 503, error: "Не удалось проверить параллельное списание" };
      }
      const saved = raced.result as { applied?: AppliedItem[]; failed?: FailedItem[] } | null;
      if (!Array.isArray(saved?.applied) || !Array.isArray(saved?.failed)) {
        return { ok: false, status: 409, error: "Списание уже выполняется; повторите позже" };
      }
      if (saved.failed.length === 0) {
        return { ok: true, applied: saved.applied, failed: [], idempotent: true };
      }
      previouslyApplied = saved.applied;
      const failedIds = new Set(saved.failed.map((item) => item.item_id));
      items = ((raced.items as WriteOffItem[] | null) ?? items)
        .filter((item) => failedIds.has(item.item_id));
    }
  }

  const applied: AppliedItem[] = [...previouslyApplied];
  const failed: FailedItem[] = [];
  let firstFailure: { status: number; message: string } | null = null;

  for (const item of items) {
    const result = await applyInventoryMovement(actor, {
      item_id: item.item_id,
      type: "OUT",
      quantity: item.quantity,
      reason: `Списание ингредиентов по заказу ${order.number}`,
      order_id: orderId,
    });
    if (result.ok) {
      applied.push({
        item_id: result.item.id,
        item_name: result.item.name,
        movement_id: result.movement.id,
        quantity: item.quantity,
        remaining: Number(result.item.quantity) || 0,
        unit: result.item.unit,
      });
    } else {
      const mapped = movementError(result.error);
      if (!firstFailure) firstFailure = mapped;
      failed.push({ item_id: item.item_id, error: mapped.message });
    }
  }

  if (applied.length === 0 && firstFailure && previouslyApplied.length === 0) {
    await supabaseAdmin.from("inventory_write_offs").delete()
      .eq("owner_id", inventoryOwnerId).eq("order_id", orderId).eq("signature", signature);
    return { ok: false, status: firstFailure.status, error: firstFailure.message, details: failed };
  }

  const { error: resultError } = await supabaseAdmin
    .from("inventory_write_offs")
    .update({ result: { state: "completed", source: "recipe", applied, failed } })
    .eq("owner_id", inventoryOwnerId)
    .eq("order_id", orderId)
    .eq("signature", signature);
  if (resultError) {
    console.error("[recipe-writeoff] result persistence failed:", resultError.message);
    return { ok: false, status: 503, error: "Списание применено, но итог не сохранён. Обратитесь в поддержку." };
  }

  if (failed.length > 0) {
    return {
      ok: false,
      status: firstFailure?.status ?? 409,
      error: "Не все ингредиенты удалось списать. Пополните склад/исправьте привязки и повторите подтверждение этапа.",
      details: { applied, failed },
    };
  }

  return { ok: true, applied, failed: [], idempotent: false };
}
