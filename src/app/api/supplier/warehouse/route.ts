/**
 * GET  /api/supplier/warehouse — список позиций склада поставщика
 * POST /api/supplier/warehouse — обновить остаток { id, quantity, minQuantity?, costPerUnit? }
 *
 * Auth: SUPPLIER
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const lowStock = searchParams.get("lowStock") === "1";

    let query = supabaseAdmin
      .from("supplier_products")
      .select("*")
      .eq("supplier_id", user.id)
      .order("product_name", { ascending: true });

    if (lowStock) {
      // Filter items below min_stock — need to do this client-side since Supabase doesn't support column-to-column comparisons
      const { data: allItems } = await query;
      const filtered = (allItems || []).filter((item: any) =>
        (item.quantity_available || 0) <= (item.min_stock || 0)
      );
      return NextResponse.json({ items: filtered });
    }

    const { data: items, error } = await query;
    if (error) console.warn("[supplier/warehouse] GET error:", error.message);

    return NextResponse.json({ items: items || [] });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json();
    const { id, quantity, minQuantity, costPerUnit } = body;

    if (!id) return NextResponse.json({ error: "Укажите id" }, { status: 400 });

    const updateData: Record<string, unknown> = {};
    if (quantity !== undefined) updateData.quantity_available = quantity;
    if (minQuantity !== undefined) updateData.min_stock = minQuantity;
    if (costPerUnit !== undefined) updateData.price_per_unit = costPerUnit;
    updateData.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabaseAdmin
      .from("supplier_products")
      .update(updateData)
      .eq("id", id)
      .eq("supplier_id", user.id) // RLS: only own products
      .select()
      .single();

    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });

    return NextResponse.json({ item: updated });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
