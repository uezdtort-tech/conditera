/**
 * /api/inventory/movements — журнал движений склада (Модуль «Склад»).
 *
 * GET  — движения по позициям текущего пользователя (?item_id= — фильтр по
 *        позиции, тоже только своей), созданные по убыванию, limit 100.
 *        Возвращает { movements: [{ id, item_id, item_name, type, quantity,
 *        reason, order_id, created_at, ... }] } — item_name обогащается
 *        вторым запросом (embed в шиме недоступен без FK-relationship в select).
 * POST — создать движение { item_id, type: 'IN'|'OUT'|'ADJUST', quantity (>0),
 *        reason (обязателен для OUT), order_id? } → 201 { movement, item }.
 *        Логика вынесена в src/lib/inventory.ts (applyInventoryMovement):
 *        владение → новый остаток (OUT не ниже 0 → 409) → insert движения →
 *        update остатка → n8n "inventory.low" при new_qty <= min_quantity.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { unauthorizedResponse } from "@/lib/supabase/auth";
import {
  applyInventoryMovement,
  INVENTORY_MOVEMENT_TYPES,
  parseMovementQuantity,
  serializeInventoryItem,
  type InventoryActor,
  type InventoryMovementRow,
} from "@/lib/inventory";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const params = new URL(request.url).searchParams;
    const itemIdFilter = params.get("item_id") || "";
    const limitRaw = Number(params.get("limit") || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 100;

    // Позиции пользователя (id + имя для обогащения журнала)
    let itemsQuery = supabaseAdmin
      .from("inventory_items")
      .select("id, name")
      .eq("owner_id", user.id);
    if (itemIdFilter) itemsQuery = itemsQuery.eq("id", itemIdFilter);
    const { data: myItems, error: itemsErr } = await itemsQuery;

    if (itemsErr) {
      console.error("[inventory/movements] load items failed:", itemsErr.message);
      return NextResponse.json({ error: "Не удалось загрузить позиции склада" }, { status: 500 });
    }

    const itemMap = new Map<string, string>();
    (myItems || []).forEach((it: { id: string; name: string }) => itemMap.set(it.id, it.name));
    const itemIds = [...itemMap.keys()];

    if (itemIds.length === 0) {
      return NextResponse.json({ movements: [] });
    }

    const { data: rows, error: movErr } = await supabaseAdmin
      .from("inventory_movements")
      .select("*")
      .in("item_id", itemIds)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (movErr) {
      console.error("[inventory/movements] GET failed:", movErr.message);
      return NextResponse.json({ error: "Не удалось загрузить журнал движений" }, { status: 500 });
    }

    const movements = (rows || []).map((m: InventoryMovementRow) => ({
      ...m,
      quantity: Number(m.quantity) || 0,
      item_name: itemMap.get(m.item_id) || null,
    }));

    return NextResponse.json({ movements });
  } catch (error) {
    console.error("[inventory/movements] GET error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
    }

    const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
    if (!itemId) {
      return NextResponse.json({ error: "item_id обязателен" }, { status: 400 });
    }

    const type = typeof body.type === "string" ? body.type.trim().toUpperCase() : "";
    if (!INVENTORY_MOVEMENT_TYPES.includes(type as never)) {
      return NextResponse.json(
        { error: "type должен быть IN, OUT или ADJUST" },
        { status: 400 }
      );
    }

    const quantity = parseMovementQuantity(body.quantity);
    if (quantity === null) {
      return NextResponse.json({ error: "quantity должно быть числом > 0" }, { status: 400 });
    }

    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (type === "OUT" && !reason) {
      return NextResponse.json(
        { error: "Для списания (OUT) причина обязательна" },
        { status: 400 }
      );
    }

    const orderId =
      typeof body.order_id === "string" && body.order_id.trim() ? body.order_id.trim() : null;

    const actor: InventoryActor = { id: user.id, roles: (user.roles as string[]) || [] };
    const result = await applyInventoryMovement(actor, {
      item_id: itemId,
      type: type as "IN" | "OUT" | "ADJUST",
      quantity,
      reason: reason || null,
      order_id: orderId,
    });

    if (!result.ok) {
      switch (result.error.kind) {
        case "not_found":
          return NextResponse.json({ error: "Позиция не найдена" }, { status: 404 });
        case "forbidden":
          return NextResponse.json(
            { error: "Нет доступа к этой позиции склада" },
            { status: 403 }
          );
        case "insufficient":
          return NextResponse.json(
            {
              error: `Недостаточно на складе: доступно ${result.error.available}`,
            },
            { status: 409 }
          );
        default:
          return NextResponse.json({ error: "Не удалось записать движение" }, { status: 500 });
      }
    }

    return NextResponse.json(
      {
        movement: { ...result.movement, quantity: Number(result.movement.quantity) || 0 },
        item: serializeInventoryItem(result.item),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[inventory/movements] POST error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
