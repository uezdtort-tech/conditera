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
 * АТОМАРНОСТЬ: supabase-js (PostgREST-шим) не даёт кросс-табличных транзакций.
 * Порядок записи: сначала INSERT движения, затем UPDATE остатка. Если UPDATE
 * упал — строка журнала остаётся (движение зафиксировано, остаток не изменён).
 * Это осознанный компромисс, задокументирован в worklog.
 *
 * n8n: после УСПЕШНОЙ записи обоих документов, если new_qty <= min_quantity,
 * отправляется событие "inventory.low" (fail-safe, ошибки игнорируются).
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { emitEvent } from "@/lib/n8n";

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

  // 2. Новый остаток
  const current = Number(row.quantity) || 0;
  const q = Number(input.quantity);
  let newQty: number;
  if (input.type === "IN") {
    newQty = current + q;
  } else if (input.type === "OUT") {
    newQty = current - q;
    if (newQty < 0) {
      return { ok: false, error: { kind: "insufficient", available: current } };
    }
  } else {
    // ADJUST — абсолютная установка
    newQty = q;
  }

  // 3. Сначала журнал, затем остаток (см. шапку про атомарность)
  const { data: movement, error: movErr } = await supabaseAdmin
    .from("inventory_movements")
    .insert({
      item_id: input.item_id,
      user_id: actor.id,
      type: input.type,
      quantity: q,
      reason: input.reason?.trim() || null,
      order_id: input.order_id || null,
    })
    .select("*")
    .single();

  if (movErr || !movement) {
    console.error("[inventory] movement insert failed:", movErr?.message);
    return { ok: false, error: { kind: "db", message: movErr?.message || "insert movement failed" } };
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("inventory_items")
    .update({ quantity: newQty, updated_at: new Date().toISOString() })
    .eq("id", input.item_id)
    .select("*")
    .single();

  if (updErr || !updated) {
    // Журнал записан, остаток не обновлён — движение останется в истории
    // (ручная сверка по inventory_movements). Не молчим: лог + ошибка 500.
    console.error(
      `[inventory] CRITICAL: движение ${movement.id} записано, но остаток item ${input.item_id} не обновлён:`,
      updErr?.message
    );
    return { ok: false, error: { kind: "db", message: updErr?.message || "update quantity failed" } };
  }

  const updatedRow = updated as InventoryItemRow;

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
  }

  return {
    ok: true,
    movement: movement as InventoryMovementRow,
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
