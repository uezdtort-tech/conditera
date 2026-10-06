/**
 * inventory.ts — общая серверная логика складского учёта (Модуль «Склад»).
 *
 * Используется роутами:
 *  - POST /api/inventory/movements (одиночное движение IN/OUT/ADJUST)
 *  - POST /api/inventory/write-off (списание набора позиций по заказу)
 *
 * Семантика остатков:
 *  - IN:     new_qty = quantity + q
 *  - OUT:    new_qty = quantity - q (результат < 0 → отказ 409)
 *  - ADJUST: new_qty = q (абсолютная установка, q > 0)
 *
 * АТОМАРНОСТЬ (миграция 0048): движение применяется через RPC
 * apply_inventory_movement_atomic — одна SQL-функция = одна транзакция:
 * SELECT ... FOR UPDATE → guard «OUT не ниже 0» → UPDATE остатка →
 * INSERT журнала. Параллельные OUT сериализуются блокировкой строки,
 * отрицательный остаток и lost update невозможны.
 * Если RPC отсутствует (миграция 0048 не применена) — fail-closed 500
 * (тот же паттерн, что у apply_yookassa_refund в payment/webhook).
 *
 * n8n: после УСПЕШНОЙ записи обоих документов, если new_qty <= min_quantity,
 * отправляется событие "inventory.low" (fail-safe, ошибки игнорируются).
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { emitEvent } from "@/lib/n8n";
import { recordEvent } from "@/lib/ops/events";

export type InventoryMovementType = "IN" | "OUT" | "ADJUST";

export const INVENTORY_MOVEMENT_TYPES: readonly InventoryMovementType[] = ["IN", "OUT", "ADJUST"];

/** Строка inventory_items (snake_case, как в БД) */
export interface InventoryItemRow {
  id: string;
  owner_id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string | null;
  min_quantity: number;
  cost_per_unit: number;
  supplier: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Строка inventory_movements */
export interface InventoryMovementRow {
  id: string;
  item_id: string;
  user_id: string | null;
  type: InventoryMovementType;
  quantity: number;
  reason: string | null;
  order_id: string | null;
  created_at: string;
}

/** Аутентифицированный пользователь (подмножество из getUserFromRequest) */
export interface InventoryActor {
  id: string;
  roles: string[];
}

export const INVENTORY_ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

export function isInventoryAdmin(actor: InventoryActor): boolean {
  return actor.roles.some((r) => INVENTORY_ADMIN_ROLES.includes(r));
}

/** Приватный элемент доступен владельцу; админ — обход владения. */
export function canManageInventoryItem(item: InventoryItemRow, actor: InventoryActor): boolean {
  if (item.owner_id === actor.id) return true;
  return isInventoryAdmin(actor);
}

export type ApplyMovementInput = {
  item_id: string;
  type: InventoryMovementType;
  /** q > 0; для ADJUST — новое абсолютное значение */
  quantity: number;
  reason?: string | null;
  order_id?: string | null;
};

export type ApplyMovementError =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "insufficient"; available: number }
  | { kind: "db"; message: string };

export type ApplyMovementResult =
  | { ok: true; movement: InventoryMovementRow; item: InventoryItemRow }
  | { ok: false; error: ApplyMovementError };

/**
 * Применить одно движение к позиции склада.
 * Проверяет владение, считает новый остаток, пишет журнал и обновляет остаток.
 */
export async function applyInventoryMovement(
  actor: InventoryActor,
  input: ApplyMovementInput
): Promise<ApplyMovementResult> {
  // 1. Позиция + проверка владения
  const { data: item, error: itemErr } = await supabaseAdmin
    .from("inventory_items")
    .select("*")
    .eq("id", input.item_id)
    .maybeSingle();

  if (itemErr) {
    console.error("[inventory] load item failed:", itemErr.message);
    return { ok: false, error: { kind: "db", message: itemErr.message } };
  }
  if (!item) {
    return { ok: false, error: { kind: "not_found" } };
  }

  const row = item as InventoryItemRow;
  if (!canManageInventoryItem(row, actor)) {
    return { ok: false, error: { kind: "forbidden" } };
  }

  // 2+3. Атомарное применение через RPC (миграция 0048): блокировка строки,
  // guard «OUT не ниже 0», UPDATE остатка и INSERT журнала в одной транзакции.
  const q = Number(input.quantity);
  const { data: rpcRes, error: rpcErr } = await supabaseAdmin
    .rpc("apply_inventory_movement_atomic", {
      p_item_id: input.item_id,
      p_type: input.type,
      p_quantity: q,
      p_actor: actor.id,
      p_reason: input.reason?.trim() || null,
      p_order_id: input.order_id || null,
    })
    .single() as {
      data: {
        ok: boolean;
        code: string;
        available: number | string | null;
        new_qty: number | string | null;
        movement: InventoryMovementRow | null;
        item: InventoryItemRow | null;
      } | null;
      error: (Error & { code?: string }) | null;
    };

  if (rpcErr && rpcErr.code === "PGRST202") {
    // 0048 не применена — НЕ применяем движение небезопасным read-check-write:
    // fail-closed, уведомляем оператора применить миграцию.
    console.error(
      "[inventory] apply_inventory_movement_atomic RPC отсутствует — fail-closed (примените миграцию 0048)"
    );
    return {
      ok: false,
      error: { kind: "db", message: "Inventory processing unavailable (apply migration 0048)" },
    };
  }
  if (rpcErr || !rpcRes) {
    console.error("[inventory] atomic movement RPC failed:", rpcErr?.message);
    return { ok: false, error: { kind: "db", message: rpcErr?.message || "movement RPC failed" } };
  }

  if (!rpcRes.ok) {
    if (rpcRes.code === "insufficient") {
      return {
        ok: false,
        error: { kind: "insufficient", available: Number(rpcRes.available) || 0 },
      };
    }
    if (rpcRes.code === "not_found") {
      return { ok: false, error: { kind: "not_found" } };
    }
    return { ok: false, error: { kind: "db", message: `movement rejected: ${rpcRes.code}` } };
  }

  if (!rpcRes.movement || !rpcRes.item) {
    return { ok: false, error: { kind: "db", message: "movement RPC returned incomplete data" } };
  }

  const movement = rpcRes.movement;
  const updatedRow = rpcRes.item;
  const newQty = Number(rpcRes.new_qty);

  // 4. Низкий остаток → n8n (fail-safe, ПОСЛЕ успешной записи)
  const minQty = Number(updatedRow.min_quantity) || 0;
  if (newQty <= minQty) {
    void emitEvent("inventory.low", {
      itemId: updatedRow.id,
      itemName: updatedRow.name,
      quantity: newQty,
      minQuantity: minQty,
      ownerId: updatedRow.owner_id,
    }).catch(() => {});

    // ops: event log (append-only, fail-safe)
    void recordEvent("inventory.low_stock", {
      entityType: "inventory_item",
      entityId: updatedRow.id,
      payload: { quantity: newQty, minQuantity: minQty },
    });
  }

  return {
    ok: true,
    movement,
    item: updatedRow,
  };
}

/** Строгий парс количества движения: конечное число > 0 */
export function parseMovementQuantity(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Валидация имени позиции: 1..200 символов после trim */
export function parseItemName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > 200) return null;
  return name;
}

/**
 * Нормализовать строку inventory_items для JSON-ответа:
 * numeric-колонки (quantity/min_quantity/cost_per_unit) pg-драйвер отдаёт
 * строками — приводим к числам, чтобы клиент получал стабильный контракт.
 */
export function serializeInventoryItem(row: InventoryItemRow): InventoryItemRow {
  return {
    ...row,
    quantity: Number(row.quantity) || 0,
    min_quantity: Number(row.min_quantity) || 0,
    cost_per_unit: Number(row.cost_per_unit) || 0,
  };
}
