/**
 * Безопасное рецептурное списание при подтверждении этапа ingredients_prepared.
 *
 * Использует тот же PostgreSQL RPC apply_order_write_off_atomic, что и ручной
 * order-write-off. Списание сериализуется на уровне заказа и сверяется с
 * acceptance_snapshot. Повторные попытки вычитают только фактически применённые
 * движения (миграция 0108), поэтому частичный результат можно безопасно завершить.
 */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isInventoryAdmin, type InventoryActor } from "@/lib/inventory";
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

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function signatureFor(items: WriteOffItem[]): string {
  const canonical = [...items]
    .map((item) => `${item.item_id}:${round6(item.quantity)}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

function mapRpcError(message: string): { status: number; error: string } {
  if (message.includes("snapshot_mismatch:")) return { status: 422, error: "Списание расходится с нормативом snapshot заказа" };
  if (message.includes("snapshot_invalid:")) return { status: 422, error: "Snapshot заказа повреждён; списание заблокировано" };
  if (message.includes("apply_failed:insufficient")) return { status: 409, error: "Недостаточно ингредиентов на складе" };
  if (message.includes("apply_failed:forbidden")) return { status: 403, error: "Нет доступа к позиции склада" };
  if (message.includes("apply_failed:not_found")) return { status: 404, error: "Позиция склада не найдена" };
  if (message.includes("ORDER_NOT_FOUND")) return { status: 404, error: "Заказ не найден" };
  return { status: 503, error: "Не удалось выполнить атомарное списание рецептуры" };
}

export async function writeOffOrderRecipe(
  actor: InventoryActor,
  orderId: string
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
    return { ok: false, status: 409, error: "Для заказа не назначен кондитер" };
  }

  const breakdown = await computeOrderBreakdown(orderId);
  if (!breakdown) return { ok: false, status: 404, error: "Не удалось рассчитать рецептуру заказа" };
  if (!breakdown.ingredients.length) {
    return { ok: false, status: 422, error: "У товаров заказа не настроены рецептуры с ингредиентами" };
  }

  // В реестре учитываем только result.applied, а не исходный items:
  // запрос мог содержать позиции, которые завершились failed.
  const { data: priorRows, error: priorError } = await supabaseAdmin
    .from("inventory_write_offs")
    .select("result")
    .eq("owner_id", actor.id)
    .eq("order_id", orderId)
    .limit(100);
  if (priorError) {
    console.error("[recipe-writeoff] prior lookup failed:", priorError.message);
    return { ok: false, status: 503, error: "Не удалось проверить предыдущие списания" };
  }

  const appliedTotals = new Map<string, number>();
  for (const row of priorRows ?? []) {
    const result = row.result as { applied?: AppliedItem[]; failed?: FailedItem[] } | null;
    if (!result || !Array.isArray(result.applied) || !Array.isArray(result.failed)) {
      return { ok: false, status: 409, error: "Предыдущее списание ещё выполняется; повторите позже" };
    }
    for (const item of result.applied) {
      if (!item?.item_id || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) continue;
      appliedTotals.set(item.item_id, round6((appliedTotals.get(item.item_id) ?? 0) + Number(item.quantity)));
    }
  }

  // Breakdown считает норму по acceptance_snapshot (если он есть), а остатки —
  // по живому складу. Нормы агрегируем по ID позиции склада.
  const expected = new Map<string, { quantity: number; unit: string; stock: number; name: string }>();
  for (const ingredient of breakdown.ingredients) {
    if (ingredient.status === "unit_mismatch") {
      return { ok: false, status: 409, error: `Несовместимые единицы ингредиента «${ingredient.name}»` };
    }
    if (!ingredient.inventory_item_id || !ingredient.warehouse_unit) {
      return { ok: false, status: 409, error: `Для ингредиента «${ingredient.name}» не настроена позиция склада` };
    }
    const quantity = convertQty(ingredient.required, ingredient.unit, ingredient.warehouse_unit);
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, status: 409, error: `Не удалось преобразовать единицы ингредиента «${ingredient.name}»` };
    }
    const prior = expected.get(ingredient.inventory_item_id);
    expected.set(ingredient.inventory_item_id, {
      quantity: round6((prior?.quantity ?? 0) + quantity),
      unit: ingredient.warehouse_unit,
      stock: Number(ingredient.warehouse_quantity ?? 0),
      name: ingredient.warehouse_item_name ?? ingredient.name,
    });
  }

  const items: WriteOffItem[] = [];
  for (const [itemId, target] of expected) {
    const alreadyApplied = appliedTotals.get(itemId) ?? 0;
    const remaining = round6(target.quantity - alreadyApplied);
    if (remaining < -0.000001) {
      return { ok: false, status: 422, error: `По позиции «${target.name}» уже списано больше рецептурной нормы` };
    }
    if (remaining <= 0.000001) continue;
    if (target.stock + 0.000001 < remaining) {
      return {
        ok: false,
        status: 409,
        error: `Недостаточно «${target.name}»: требуется ещё ${remaining} ${target.unit}, доступно ${target.stock} ${target.unit}`,
        details: { item_id: itemId, required: remaining, available: target.stock, unit: target.unit },
      };
    }
    items.push({ item_id: itemId, quantity: remaining });
  }

  if (items.length === 0) {
    const applied = (priorRows ?? []).flatMap((row) => {
      const result = row.result as { applied?: AppliedItem[] } | null;
      return Array.isArray(result?.applied) ? result.applied : [];
    });
    return { ok: true, applied, failed: [], idempotent: true };
  }

  const signature = signatureFor(items);
  const { data, error } = await supabaseAdmin.rpc("apply_order_write_off_atomic", {
    p_owner_id: actor.id,
    p_order_id: orderId,
    p_items: items,
    p_signature: signature,
    p_reason: `Рецептурное списание по заказу ${order.number}`,
    p_allow_overage: false,
    p_actor_is_admin: isInventoryAdmin(actor),
  }) as unknown as {
    data: { applied?: AppliedItem[]; failed?: FailedItem[]; idempotent?: boolean } | null;
    error: (Error & { code?: string }) | null;
  };

  if (error) {
    if (error.code === "PGRST202") {
      return { ok: false, status: 503, error: "Атомарное списание недоступно: примените миграцию 0081 и 0108" };
    }
    const mapped = mapRpcError(error.message || "");
    console.error("[recipe-writeoff] atomic RPC failed:", error.message);
    return { ok: false, status: mapped.status, error: mapped.error };
  }
  if (!data) return { ok: false, status: 503, error: "RPC списания не вернул результат" };

  const applied = Array.isArray(data.applied) ? data.applied : [];
  const failed = Array.isArray(data.failed) ? data.failed : [];
  if (failed.length > 0) {
    return {
      ok: false,
      status: 409,
      error: "Не все ингредиенты удалось списать. Пополните склад или исправьте привязки и повторите этап.",
      details: { applied, failed },
    };
  }
  return { ok: true, applied, failed: [], idempotent: data.idempotent === true };
}
