/**
 * /api/inventory/items — CRUD позиций склада кондитера (Модуль «Склад»).
 *
 * GET    — список позиций текущего пользователя (owner_id = user.id), по имени.
 * POST   — создать позицию { name, category?, quantity?, unit?, min_quantity?,
 *          cost_per_unit?, supplier? } → 201 { item }.
 * PATCH  — обновить позицию по body.id (только whitelist-поля), владение 403.
 * DELETE — soft-delete: is_active=false (владение), { success: true }.
 *
 * Auth: getUserFromRequest (Bearer + cookie cd_session). Владение:
 * inventory_items.owner_id === user.id, админ (ADMIN/SUPER_ADMIN) — обход.
 * Таблица inventory_items (миграция 0010); expiry_date/storage_location в схеме
 * отсутствуют — UI их не показывает.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/supabase/auth";
import {
  canManageInventoryItem,
  parseItemName,
  serializeInventoryItem,
  type InventoryActor,
  type InventoryItemRow,
} from "@/lib/inventory";

export const runtime = "nodejs";

const MAX_TEXT_LEN = 200;

/** Парс опционального текстового поля (trim + ограничение длины) */
function parseOptionalText(raw: unknown, maxLen = MAX_TEXT_LEN): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return null;
  return value.slice(0, maxLen);
}

/** Парс неотрицательного конечного числа; null — невалидно/не передано как число */
function parseNonNegativeNumber(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const includeInactive = new URL(request.url).searchParams.get("include_inactive") === "1";

    let query = supabaseAdmin
      .from("inventory_items")
      .select("*")
      .eq("owner_id", user.id)
      .order("name", { ascending: true });
    if (!includeInactive) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) {
      console.error("[inventory/items] GET failed:", error.message);
      return NextResponse.json({ error: "Не удалось загрузить склад" }, { status: 500 });
    }

    const items = (data || []).map((row) => serializeInventoryItem(row as InventoryItemRow));
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[inventory/items] GET error:", (error as Error).message);
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

    const name = parseItemName(body.name);
    if (!name) {
      return NextResponse.json(
        { error: "name обязателен (1..200 символов)" },
        { status: 400 }
      );
    }

    const quantity = parseNonNegativeNumber(body.quantity ?? 0);
    if (quantity === null) {
      return NextResponse.json({ error: "quantity должно быть числом ≥ 0" }, { status: 400 });
    }
    const minQuantity = parseNonNegativeNumber(body.min_quantity ?? 0);
    if (minQuantity === null) {
      return NextResponse.json({ error: "min_quantity должно быть числом ≥ 0" }, { status: 400 });
    }
    // cost_per_unit в БД — integer (дробные копейки схемой не поддержаны)
    const costRaw = parseNonNegativeNumber(body.cost_per_unit ?? 0);
    if (costRaw === null) {
      return NextResponse.json({ error: "cost_per_unit должно быть числом ≥ 0" }, { status: 400 });
    }
    const costPerUnit = Math.round(costRaw);

    const category = parseOptionalText(body.category);
    if (category === undefined && body.category !== undefined) {
      return NextResponse.json({ error: "category должен быть строкой" }, { status: 400 });
    }
    const supplier = parseOptionalText(body.supplier);
    if (supplier === undefined && body.supplier !== undefined) {
      return NextResponse.json({ error: "supplier должен быть строкой" }, { status: 400 });
    }
    const unitRaw = parseOptionalText(body.unit, 50);
    const unit = unitRaw === undefined || !unitRaw ? "шт" : unitRaw;

    const { data, error } = await supabaseAdmin
      .from("inventory_items")
      .insert({
        owner_id: user.id,
        name,
        category: category ?? null,
        quantity,
        unit,
        min_quantity: minQuantity,
        cost_per_unit: costPerUnit,
        supplier: supplier ?? null,
        is_active: true,
      })
      .select("*")
      .single();

    if (error || !data) {
      console.error("[inventory/items] insert failed:", error?.message);
      return NextResponse.json({ error: "Не удалось создать позицию склада" }, { status: 500 });
    }

    return NextResponse.json(
      { item: serializeInventoryItem(data as InventoryItemRow) },
      { status: 201 }
    );
  } catch (error) {
    console.error("[inventory/items] POST error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "id позиции обязателен" }, { status: 400 });
    }
    const itemId = body.id as string;

    // Владение: владелец или админ
    const { data: existing, error: loadErr } = await supabaseAdmin
      .from("inventory_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();
    if (loadErr) {
      console.error("[inventory/items] PATCH load failed:", loadErr.message);
      return NextResponse.json({ error: "Не удалось загрузить позицию" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Позиция не найдена" }, { status: 404 });
    }

    const actor: InventoryActor = { id: user.id, roles: (user.roles as string[]) || [] };
    if (!canManageInventoryItem(existing as InventoryItemRow, actor)) {
      return forbiddenResponse("Нет доступа к этой позиции склада");
    }

    // Whitelist полей
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = parseItemName(body.name);
      if (!name) {
        return NextResponse.json({ error: "name: 1..200 символов" }, { status: 400 });
      }
      updates.name = name;
    }
    if (body.category !== undefined) {
      const category = parseOptionalText(body.category);
      if (category === undefined) {
        return NextResponse.json({ error: "category должен быть строкой" }, { status: 400 });
      }
      updates.category = category;
    }
    if (body.quantity !== undefined) {
      const quantity = parseNonNegativeNumber(body.quantity);
      if (quantity === null) {
        return NextResponse.json({ error: "quantity должно быть числом ≥ 0" }, { status: 400 });
      }
      updates.quantity = quantity;
    }
    if (body.unit !== undefined) {
      const unit = parseOptionalText(body.unit, 50);
      if (unit === undefined) {
        return NextResponse.json({ error: "unit должен быть строкой" }, { status: 400 });
      }
      updates.unit = unit || "шт";
    }
    if (body.min_quantity !== undefined) {
      const minQuantity = parseNonNegativeNumber(body.min_quantity);
      if (minQuantity === null) {
        return NextResponse.json({ error: "min_quantity должно быть числом ≥ 0" }, { status: 400 });
      }
      updates.min_quantity = minQuantity;
    }
    if (body.cost_per_unit !== undefined) {
      const cost = parseNonNegativeNumber(body.cost_per_unit);
      if (cost === null) {
        return NextResponse.json({ error: "cost_per_unit должно быть числом ≥ 0" }, { status: 400 });
      }
      updates.cost_per_unit = Math.round(cost);
    }
    if (body.supplier !== undefined) {
      const supplier = parseOptionalText(body.supplier);
      if (supplier === undefined) {
        return NextResponse.json({ error: "supplier должен быть строкой" }, { status: 400 });
      }
      updates.supplier = supplier;
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        return NextResponse.json({ error: "is_active должен быть boolean" }, { status: 400 });
      }
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("inventory_items")
      .update(updates)
      .eq("id", itemId)
      .select("*")
      .single();

    if (error || !data) {
      console.error("[inventory/items] update failed:", error?.message);
      return NextResponse.json({ error: "Не удалось обновить позицию" }, { status: 500 });
    }

    return NextResponse.json({ item: serializeInventoryItem(data as InventoryItemRow) });
  } catch (error) {
    console.error("[inventory/items] PATCH error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const itemId = new URL(request.url).searchParams.get("id") || "";
    if (!itemId) {
      return NextResponse.json({ error: "id позиции обязателен (?id=)" }, { status: 400 });
    }

    const { data: existing, error: loadErr } = await supabaseAdmin
      .from("inventory_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();
    if (loadErr) {
      console.error("[inventory/items] DELETE load failed:", loadErr.message);
      return NextResponse.json({ error: "Не удалось загрузить позицию" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Позиция не найдена" }, { status: 404 });
    }

    const actor: InventoryActor = { id: user.id, roles: (user.roles as string[]) || [] };
    if (!canManageInventoryItem(existing as InventoryItemRow, actor)) {
      return forbiddenResponse("Нет доступа к этой позиции склада");
    }

    // Soft-delete: журнал движений и история остаются связными
    const { error } = await supabaseAdmin
      .from("inventory_items")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", itemId);
    if (error) {
      console.error("[inventory/items] soft-delete failed:", error.message);
      return NextResponse.json({ error: "Не удалось удалить позицию" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[inventory/items] DELETE error:", (error as Error).message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
