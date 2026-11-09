/**
 * Каталог и остатки поставщика (supplier_products) — Z-v17.
 *
 * GET    /api/supplier/warehouse            — свои товары (+доступно к заказу)
 * POST   /api/supplier/warehouse            — создать товар
 * PATCH  /api/supplier/warehouse            — обновить товар / статус публикации
 *                                             / пополнить остаток
 * DELETE /api/supplier/warehouse?id=…       — архивировать (soft)
 *
 * Статусы товара: draft → published → archived (обратимо, кроме архива черновика).
 * Публикация разрешена только поставщику с verificationStatus='approved'.
 * Остаток: quantity (физический), reserved_quantity (резерв под заказы),
 * available = quantity - reserved_quantity. Пополнение — движение IN в журнал.
 *
 * Auth: SUPPLIER, все операции только по своим товарам (supplier_id = user.id).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { validateProduct, type ProductInput } from "@/lib/supplier-warehouse-validation";

export const runtime = "nodejs";

function bad(error: string, details?: unknown, status = 400) {
  return NextResponse.json({ error, details }, { status });
}

async function getSupplierContext(userId: string) {
  const { data: profile } = await supabaseAdmin
    .from("supplier_profiles")
    .select("id, verificationStatus, isActive, companyName")
    .eq("userId", userId)
    .maybeSingle();
  return profile;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return bad("Не авторизован", undefined, 401);
    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = supabaseAdmin
      .from("supplier_products")
      .select("*")
      .eq("supplier_id", user.id)
      .is("is_active", true)
      .order("product_name", { ascending: true });

    if (status && ["draft", "published", "archived"].includes(status)) {
      query = query.eq("status", status);
    }

    const { data: items, error } = await query;
    if (error) {
      console.error("[supplier/warehouse] GET error:", error.message);
      return bad("Ошибка чтения каталога", undefined, 500);
    }

    const enriched = (items ?? []).map((it: Record<string, unknown>) => ({
      ...it,
      available_quantity: Number(it.quantity ?? 0) - Number(it.reserved_quantity ?? 0),
    }));

    return NextResponse.json({ items: enriched });
  } catch (e: any) {
    console.error("[supplier/warehouse] GET:", e?.message);
    return bad("Ошибка сервера", undefined, 500);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return bad("Не авторизован", undefined, 401);
    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const profile = await getSupplierContext(user.id);
    if (!profile) return bad("Профиль поставщика не найден", undefined, 404);

    const body = (await request.json()) as ProductInput;
    const errors = validateProduct(body);
    if (errors.length) return bad("Ошибки валидации", errors);

    // Новый товар всегда создаётся черновиком — публикация отдельным действием.
    const { data: item, error } = await supabaseAdmin
      .from("supplier_products")
      .insert({
        supplier_id: user.id,
        product_name: String(body.productName).trim(),
        sku: body.sku?.trim() || null,
        category: body.category ?? "other",
        description: body.description?.trim() || null,
        unit: body.unit ?? "piece",
        quantity: Math.max(0, Number(body.quantity ?? 0)),
        min_stock: Math.max(0, Number(body.minStock ?? 0)),
        price: Math.max(0, Number(body.price ?? 0)),
        cost_price: body.costPrice !== undefined ? Math.max(0, Number(body.costPrice)) : null,
        producer: body.producer?.trim() || null,
        brand: body.brand?.trim() || null,
        min_order_qty: Math.max(1, Number(body.minOrderQty ?? 1)),
        order_step: Math.max(1, Number(body.orderStep ?? 1)),
        shelf_life_days: body.shelfLifeDays ?? null,
        storage_conditions: body.storageConditions?.trim() || null,
        delivery_region: body.deliveryRegion?.trim() || null,
        image_url: body.imageUrl?.trim() || null,
        status: "draft",
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("[supplier/warehouse] POST error:", error.message);
      return bad("Ошибка создания товара", error.message, 500);
    }

    // Начальный остаток — движение IN.
    const initialQty = Number(body.quantity ?? 0);
    if (initialQty > 0) {
      const pool = getPool();
      await pool.query(
        `INSERT INTO supplier_product_movements
           (product_id, supplier_id, type, quantity, reason, created_by)
         VALUES ($1,$2,'IN',$3,'Начальный остаток',$4)`,
        [item.id, user.id, initialQty, user.id]
      );
    }

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error("[supplier/warehouse] POST:", e?.message);
    return bad("Ошибка сервера", undefined, 500);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return bad("Не авторизован", undefined, 401);
    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = (await request.json()) as ProductInput & {
      id?: string;
      action?: "publish" | "unpublish" | "archive" | "restock";
      restockQuantity?: number;
    };
    if (!body.id) return bad("Укажите id товара");

    const { data: existing } = await supabaseAdmin
      .from("supplier_products")
      .select("id, status, quantity, reserved_quantity")
      .eq("id", body.id)
      .eq("supplier_id", user.id) // только свой товар
      .maybeSingle();
    if (!existing) return bad("Товар не найден", undefined, 404);

    // Статусные действия.
    if (body.action) {
      const profile = await getSupplierContext(user.id);
      const approved = profile?.verificationStatus === "approved" && profile?.isActive;

      if (body.action === "publish") {
        if (existing.status === "published") return bad("Товар уже опубликован");
        if (!approved) {
          return bad("Публикация доступна только одобренным поставщикам", undefined, 403);
        }
        const { data, error } = await supabaseAdmin
          .from("supplier_products")
          .update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("supplier_id", user.id)
          .select()
          .single();
        if (error) return bad("Ошибка публикации", error.message, 500);
        return NextResponse.json({ item: { ...data, available_quantity: Number(data.quantity) - Number(data.reserved_quantity) } });
      }

      if (body.action === "unpublish") {
        if (existing.status !== "published") return bad("Снять с публикации можно только опубликованный товар");
        const { data, error } = await supabaseAdmin
          .from("supplier_products")
          .update({ status: "draft", published_at: null, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("supplier_id", user.id)
          .select()
          .single();
        if (error) return bad("Ошибка снятия с публикации", error.message, 500);
        return NextResponse.json({ item: { ...data, available_quantity: Number(data.quantity) - Number(data.reserved_quantity) } });
      }

      if (body.action === "archive") {
        if (Number(existing.reserved_quantity) > 0) {
          return bad("Нельзя архивировать товар с активным резервом под заказы");
        }
        const { data, error } = await supabaseAdmin
          .from("supplier_products")
          .update({ status: "archived", published_at: null, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("supplier_id", user.id)
          .select()
          .single();
        if (error) return bad("Ошибка архивации", error.message, 500);
        return NextResponse.json({ item: { ...data, available_quantity: Number(data.quantity) - Number(data.reserved_quantity) } });
      }

      if (body.action === "restock") {
        const qty = Number(body.restockQuantity);
        if (!Number.isInteger(qty) || qty <= 0 || qty > 1_000_000) {
          return bad("Количество пополнения должно быть целым положительным числом");
        }
        const pool = getPool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const upd = await client.query(
            `UPDATE supplier_products
                SET quantity = quantity + $2, last_restocked_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND supplier_id = $3
              RETURNING id, quantity, reserved_quantity`,
            [existing.id, qty, user.id]
          );
          if (upd.rowCount === 0) {
            await client.query("ROLLBACK");
            return bad("Товар не найден", undefined, 404);
          }
          await client.query(
            `INSERT INTO supplier_product_movements
               (product_id, supplier_id, type, quantity, reason, created_by)
             VALUES ($1,$2,'IN',$3,'Пополнение остатка',$4)`,
            [existing.id, user.id, qty, user.id]
          );
          await client.query("COMMIT");
          const row = upd.rows[0];
          return NextResponse.json({
            item: {
              id: row.id,
              quantity: Number(row.quantity),
              reserved_quantity: Number(row.reserved_quantity),
              available_quantity: Number(row.quantity) - Number(row.reserved_quantity),
            },
          });
        } finally {
          client.release();
        }
      }

      return bad("Недопустимое действие");
    }

    // Обычное обновление полей.
    const errors = validateProduct(body, true);
    if (errors.length) return bad("Ошибки валидации", errors);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const fieldMap: Partial<Record<keyof ProductInput, string>> = {
      productName: "product_name",
      sku: "sku",
      category: "category",
      description: "description",
      unit: "unit",
      minStock: "min_stock",
      price: "price",
      costPrice: "cost_price",
      producer: "producer",
      brand: "brand",
      minOrderQty: "min_order_qty",
      orderStep: "order_step",
      shelfLifeDays: "shelf_life_days",
      storageConditions: "storage_conditions",
      deliveryRegion: "delivery_region",
      imageUrl: "image_url",
    };
    for (const [key, column] of Object.entries(fieldMap)) {
      if (body[key as keyof ProductInput] !== undefined) {
        const value = body[key as keyof ProductInput];
        update[column] = typeof value === "string" ? (value.trim() || null) : value;
      }
    }
    // Остаток напрямую через PATCH не меняется — только restock (журнал движений).
    if (body.quantity !== undefined) {
      return bad("Остаток изменяется действием restock (с журналом движений)");
    }

    const { data, error } = await supabaseAdmin
      .from("supplier_products")
      .update(update)
      .eq("id", existing.id)
      .eq("supplier_id", user.id)
      .select()
      .single();
    if (error) return bad("Ошибка обновления", error.message, 500);

    return NextResponse.json({
      item: { ...data, available_quantity: Number(data.quantity) - Number(data.reserved_quantity) },
    });
  } catch (e: any) {
    console.error("[supplier/warehouse] PATCH:", e?.message);
    return bad("Ошибка сервера", undefined, 500);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return bad("Не авторизован", undefined, 401);
    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return bad("Укажите id товара");

    const { data: existing } = await supabaseAdmin
      .from("supplier_products")
      .select("id, reserved_quantity")
      .eq("id", id)
      .eq("supplier_id", user.id)
      .maybeSingle();
    if (!existing) return bad("Товар не найден", undefined, 404);
    if (Number(existing.reserved_quantity) > 0) {
      return bad("Нельзя удалять товар с активным резервом под заказы");
    }

    // Soft-delete: скрытие из всех статусов и каталога.
    const { error } = await supabaseAdmin
      .from("supplier_products")
      .update({ is_active: false, status: "archived", published_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("supplier_id", user.id);
    if (error) return bad("Ошибка удаления", error.message, 500);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[supplier/warehouse] DELETE:", e?.message);
    return bad("Ошибка сервера", undefined, 500);
  }
}
