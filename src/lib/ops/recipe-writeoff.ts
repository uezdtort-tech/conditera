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

export type RecipeWriteOffResult =
  | { ok: true; applied: AppliedItem[]; failed: FailedItem[]; idempotent: boolean }
  | { ok: false; status: number; error: string; details?: unknown };

function signatureFor(items: Array<{ item_id: string; quantity: number }>): string {
  const canonical = [...items]
    .map((item) => `${item.item_id}:${item.quantity}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
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

  const items: Array<{ item_id: string; quantity: number }> = [];
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

  const signature = signatureFor(items);
  const { error: claimError } = await supabaseAdmin.from("inventory_write_offs").insert({
    owner_id: actor.id,
    order_id: orderId,
    signature,
    items,
    result: { state: "processing" },
  });

  if (claimError) {
    if ((claimError as { code?: string }).code !== "23505") {
      console.error("[recipe-writeoff] claim failed:", claimError.message);
      return { ok: false, status: 503, error: "Не удалось зарезервировать списание. Повторите позже." };
    }
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("inventory_write_offs")
      .select("result")
      .eq("owner_id", actor.id)
      .eq("order_id", orderId)
      .eq("signature", signature)
      .maybeSingle();
    if (existingError || !existing) {
      return { ok: false, status: 503, error: "Не удалось проверить предыдущее списание" };
    }
    const saved = existing.result as { applied?: AppliedItem[]; failed?: FailedItem[] } | null;
    if (!Array.isArray(saved?.applied) || !Array.isArray(saved?.failed)) {
      return { ok: false, status: 409, error: "Списание уже выполняется; повторите позже" };
    }
    if (saved.failed.length === 0) {
      return { ok: true, applied: saved.applied, failed: [], idempotent: true };
    }
    // Предыдущая попытка могла списать часть ингредиентов. Повторяем только
    // неуспешные позиции, не трогая уже списанные (защита от двойного расхода).
    const failedIds = new Set(saved.failed.map((item) => item.item_id));
    items = items.filter((item) => failedIds.has(item.item_id));
    var previouslyApplied: AppliedItem[] = saved.applied;
  }

  const applied: AppliedItem[] = typeof previouslyApplied !== "undefined" ? [...previouslyApplied] : [];
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
      continue;
    }

    const message =
      result.error.kind === "insufficient"
        ? `Недостаточно на складе: доступно ${result.error.available}`
        : result.error.kind === "forbidden"
          ? "Нет доступа к позиции склада"
          : result.error.kind === "not_found"
            ? "Позиция склада не найдена"
            : "Не удалось записать движение склада";
    const status =
      result.error.kind === "insufficient" ? 409 :
      result.error.kind === "forbidden" ? 403 :
      result.error.kind === "not_found" ? 404 : 500;
    if (!firstFailure) firstFailure = { status, message };
    failed.push({ item_id: item.item_id, error: message });
  }

  if (applied.length === 0 && firstFailure && typeof previouslyApplied === "undefined") {
    await supabaseAdmin.from("inventory_write_offs").delete()
      .eq("owner_id", actor.id).eq("order_id", orderId).eq("signature", signature);
    return { ok: false, status: firstFailure.status, error: firstFailure.message, details: failed };
  }

  const { error: resultError } = await supabaseAdmin
    .from("inventory_write_offs")
    .update({ result: { state: "completed", applied, failed } })
    .eq("owner_id", actor.id)
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
