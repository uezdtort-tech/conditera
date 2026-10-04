/**
 * /api/supplier/products
 *
 * GET  — список товаров поставщика (ингредиенты / оборудование).
 * POST — создать новый товар.
 *
 * Товары поставщика хранятся в таблице inventory_items (модель InventoryItem).
 * Поле owner_id в этой таблице не имеет FK-ограничения, поэтому мы
 * используем его как «ownerId» — туда пишем userId поставщика.
 *
 * Auth: SUPPLIER role.
 * Gate: профиль поставщика должен быть активен (supplier_profiles.isActive = true).
 *
 * Безопасность:
 *   • GET: требует роль SUPPLIER + ownership через .eq("owner_id", userId).
 *   • POST: safeJsonBody + валидация полей (name, category обязательны).
 *   • POST: проверка supplier_profile.is_active перед insert.
 *   • При DB error не возвращаем детали БД клиенту.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface SupplierProfileRow {
  id: string;
  userId: string;
  companyName: string;
  isActive: boolean | null;
}

interface InventoryItemRow {
  id: string;
  owner_id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  min_quantity: number;
  cost_per_unit: number;
  supplier: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

const UNITS = ["kg", "g", "l", "ml", "pcs", "pack", "box"] as const;
const MAX_NAME_LENGTH = 200;
const MAX_QUANTITY = 1_000_000;
const MAX_COST = 1_000_000;

interface CreateProductBody {
  name?: string;
  category?: string;
  unit?: string;
  quantity?: number;
  minQuantity?: number;
  costPerUnit?: number;
  expiryDate?: string;
  storageLocation?: string;
}

async function getActiveSupplier(userId: string): Promise<SupplierProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from("supplier_profiles")
    .select("id, userId, companyName, isActive")
    .eq("userId", userId)
    .maybeSingle() as { data: SupplierProfileRow | null; error: SupabaseError | null };

  if (error) {
    console.error("[supplier/products] profile lookup failed:", error.message);
    return null;
  }
  return data;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    if (!user.roles.includes("SUPPLIER")) {
      throw new HttpError(403, "Нет прав");
    }

    const { data: products, error } = await supabaseAdmin
      .from("inventory_items")
      .select("*")
      .eq("owner_id", user.userId)
      .order("created_at", { ascending: false }) as { data: InventoryItemRow[] | null; error: SupabaseError | null };

    if (error) {
      console.error("[supplier/products] GET failed:", error.message);
      throw new HttpError(500, "Не удалось загрузить товары");
    }

    return NextResponse.json({ products: products || [], total: (products || []).length });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    if (!user.roles.includes("SUPPLIER")) {
      throw new HttpError(403, "Нет прав");
    }

    // Gate: поставщик должен быть подтверждён (is_active = true).
    const supplier = await getActiveSupplier(user.userId);
    if (!supplier) {
      throw new HttpError(404, "Профиль поставщика не найден");
    }
    if (supplier.isActive !== true) {
      return NextResponse.json(
        {
          error: "Профиль поставщика не активирован. Ожидайте проверки администратором.",
          requiresApproval: true,
        },
        { status: 403 }
      );
    }

    const { data: body, error: parseErr } = await safeJsonBody<CreateProductBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Валидация обязательных полей
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new HttpError(400, "Укажите name");
    }
    if (body.name.length > MAX_NAME_LENGTH) {
      throw new HttpError(422, `name слишком длинный (макс ${MAX_NAME_LENGTH})`);
    }
    if (typeof body.category !== "string" || body.category.trim().length === 0) {
      throw new HttpError(400, "Укажите category");
    }

    // Валидация unit (enum)
    const unitResult = readEnumField(
      { unit: body.unit || "kg" },
      "unit",
      UNITS
    );
    if (unitResult.error || !unitResult.value) {
      throw new HttpError(422, unitResult.error || `unit должен быть одним из: ${UNITS.join(", ")}`);
    }
    const unit = unitResult.value;

    // Валидация числовых полей
    const quantity = typeof body.quantity === "number" && Number.isFinite(body.quantity)
      ? Math.max(0, Math.min(body.quantity, MAX_QUANTITY))
      : 0;
    const minQuantity = typeof body.minQuantity === "number" && Number.isFinite(body.minQuantity)
      ? Math.max(0, Math.min(body.minQuantity, MAX_QUANTITY))
      : 0;
    const costPerUnit = typeof body.costPerUnit === "number" && Number.isFinite(body.costPerUnit)
      ? Math.max(0, Math.min(body.costPerUnit, MAX_COST))
      : 0;

    // Примечание: expiry_date/storage_location в inventory_items нет (реальная схема:
    // id, owner_id, name, category, quantity, unit, min_quantity, cost_per_unit,
    // supplier, is_active, created_at, updated_at) — поля тела игнорируются.

    const { data: product, error: insertErr } = await supabaseAdmin
      .from("inventory_items")
      .insert({
        owner_id: user.userId, // ownerId — поставщик
        name: body.name,
        category: body.category,
        unit,
        quantity,
        min_quantity: minQuantity,
        cost_per_unit: costPerUnit,
        supplier: supplier.companyName,
        created_at: new Date().toISOString(),
      })
      .select()
      .single() as { data: InventoryItemRow | null; error: SupabaseError | null };

    if (insertErr || !product) {
      console.error("[supplier/products] insert failed:", insertErr?.message);
      throw new HttpError(500, "Не удалось создать товар");
    }

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH — обновление товара поставщика.
 * Body: { id, name?, category?, unit?, quantity?, minQuantity?, costPerUnit? }
 * Ownership: inventory_items.owner_id === userId.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");
    if (!user.roles.includes("SUPPLIER")) throw new HttpError(403, "Нет прав");

    const { data: body, error: parseErr } = await safeJsonBody<CreateProductBody & { id?: string }>(request);
    if (parseErr) throw new HttpError(400, parseErr);
    if (!body || typeof body.id !== "string" || body.id.length === 0) {
      throw new HttpError(400, "Укажите id товара");
    }

    // Существование + ownership
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("inventory_items")
      .select("id, owner_id")
      .eq("id", body.id)
      .maybeSingle() as { data: { id: string; owner_id: string } | null; error: SupabaseError | null };

    if (fetchErr) throw new HttpError(500, "Не удалось проверить товар");
    if (!existing) throw new HttpError(404, "Товар не найден");
    if (existing.owner_id !== user.userId) throw new HttpError(403, "Нет доступа к этому товару");

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        throw new HttpError(400, "Укажите name");
      }
      if (body.name.length > MAX_NAME_LENGTH) {
        throw new HttpError(422, `name слишком длинный (макс ${MAX_NAME_LENGTH})`);
      }
      updates.name = body.name.trim();
    }

    if (body.category !== undefined) {
      if (typeof body.category !== "string" || body.category.trim().length === 0) {
        throw new HttpError(400, "Укажите category");
      }
      updates.category = body.category.trim();
    }

    if (body.unit !== undefined) {
      const unitResult = readEnumField({ unit: body.unit }, "unit", UNITS);
      if (unitResult.error || !unitResult.value) {
        throw new HttpError(422, unitResult.error || `unit должен быть одним из: ${UNITS.join(", ")}`);
      }
      updates.unit = unitResult.value;
    }

    if (body.quantity !== undefined) {
      if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity) || body.quantity < 0) {
        throw new HttpError(422, "quantity должен быть неотрицательным числом");
      }
      updates.quantity = Math.min(body.quantity, MAX_QUANTITY);
    }

    if (body.minQuantity !== undefined) {
      if (typeof body.minQuantity !== "number" || !Number.isFinite(body.minQuantity) || body.minQuantity < 0) {
        throw new HttpError(422, "minQuantity должен быть неотрицательным числом");
      }
      updates.min_quantity = Math.min(body.minQuantity, MAX_QUANTITY);
    }

    if (body.costPerUnit !== undefined) {
      if (typeof body.costPerUnit !== "number" || !Number.isFinite(body.costPerUnit) || body.costPerUnit < 0) {
        throw new HttpError(422, "costPerUnit должен быть неотрицательным числом");
      }
      updates.cost_per_unit = Math.min(body.costPerUnit, MAX_COST);
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, "Нет полей для обновления");
    }

    const { data: product, error: updateErr } = await supabaseAdmin
      .from("inventory_items")
      .update(updates)
      .eq("id", body.id)
      .select()
      .single() as { data: InventoryItemRow | null; error: SupabaseError | null };

    if (updateErr || !product) {
      console.error("[supplier/products] update failed:", updateErr?.message);
      throw new HttpError(500, "Не удалось обновить товар");
    }

    return NextResponse.json({ product });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE — удаление товара поставщика.
 * Query: ?id=<uuid>
 * Ownership: inventory_items.owner_id === userId.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");
    if (!user.roles.includes("SUPPLIER")) throw new HttpError(403, "Нет прав");

    const id = request.nextUrl.searchParams.get("id");
    if (!id) throw new HttpError(400, "Укажите ?id=");

    // Существование + ownership
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("inventory_items")
      .select("id, owner_id")
      .eq("id", id)
      .maybeSingle() as { data: { id: string; owner_id: string } | null; error: SupabaseError | null };

    if (fetchErr) throw new HttpError(500, "Не удалось проверить товар");
    if (!existing) throw new HttpError(404, "Товар не найден");
    if (existing.owner_id !== user.userId) throw new HttpError(403, "Нет доступа к этому товару");

    const { error: deleteErr } = await supabaseAdmin
      .from("inventory_items")
      .delete()
      .eq("id", id) as { error: SupabaseError | null };

    if (deleteErr) {
      console.error("[supplier/products] delete failed:", deleteErr.message);
      throw new HttpError(500, "Не удалось удалить товар");
    }

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return handleRouteError(error);
  }
}
