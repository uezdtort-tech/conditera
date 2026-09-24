/**
 * /api/supplier/products
 *
 * GET  — список товаров поставщика (ингредиенты / оборудование).
 * POST — создать новый товар.
 *
 * Товары поставщика хранятся в таблице inventory_items (модель InventoryItem).
 * Поле confectioner_id в этой таблице не имеет FK-ограничения, поэтому мы
 * используем его как «ownerId» — туда пишем userId поставщика.
 *
 * Auth: SUPPLIER role.
 * Gate: профиль поставщика должен быть активен (supplier_profiles.is_active = true).
 *
 * Безопасность:
 *   • GET: требует роль SUPPLIER + ownership через .eq("confectioner_id", userId).
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
  user_id: string;
  company_name: string;
  is_active: boolean | null;
}

interface InventoryItemRow {
  id: string;
  confectioner_id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  min_quantity: number;
  cost_per_unit: number;
  supplier_id: string | null;
  supplier_name: string | null;
  expiry_date: string | null;
  storage_location: string | null;
  created_at: string;
}

const UNITS = ["kg", "g", "l", "ml", "pcs", "pack", "box"] as const;
const MAX_NAME_LENGTH = 200;
const MAX_STORAGE_LENGTH = 200;
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
    .select("id, user_id, company_name, is_active")
    .eq("user_id", userId)
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
      .eq("confectioner_id", user.userId)
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
    if (supplier.is_active !== true) {
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

    // Валидация storageLocation
    const storageLocation =
      typeof body.storageLocation === "string" && body.storageLocation.length <= MAX_STORAGE_LENGTH
        ? body.storageLocation
        : null;

    // Валидация expiryDate (ISO string)
    let expiryDate: string | null = null;
    if (typeof body.expiryDate === "string" && body.expiryDate.length > 0) {
      const parsed = new Date(body.expiryDate);
      if (!isNaN(parsed.getTime())) {
        expiryDate = parsed.toISOString();
      }
    }

    const { data: product, error: insertErr } = await supabaseAdmin
      .from("inventory_items")
      .insert({
        confectioner_id: user.userId, // ownerId — поставщик
        name: body.name,
        category: body.category,
        unit,
        quantity,
        min_quantity: minQuantity,
        cost_per_unit: costPerUnit,
        supplier_id: user.userId,
        supplier_name: supplier.company_name,
        expiry_date: expiryDate,
        storage_location: storageLocation,
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
