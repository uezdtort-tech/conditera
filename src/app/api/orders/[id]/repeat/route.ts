/**
 * POST /api/orders/[id]/repeat — Повторить заказ (создать копию).
 *
 * Создаёт новый order с теми же позициями (snapshot цен обновляется).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse } from "@/lib/supabase/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    // Загрузить оригинальный заказ + позиции
    const { data: original } = await supabaseAdmin
      .from("orders")
      .select(`
        *,
        items:order_items(product_id, product_title, unit_price, quantity, selected_attributes)
      `)
      .eq("id", orderId)
      .single();

    if (!original) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    if (original.user_id !== user.id && !user.roles.some((r: string) => ["ADMIN", "SUPER_ADMIN"].includes(r)))
      return NextResponse.json({ error: "Нет прав" }, { status: 403 });

    // Создать новый заказ (копия)
    const { data: newOrder, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: user.id,
        confectioner_id: original.confectioner_id,
        subtotal: original.subtotal,
        delivery_cost: original.delivery_cost,
        discount: 0,
        total: original.subtotal + original.delivery_cost,
        status: "PENDING",
        type: "product",
        delivery_address: original.delivery_address,
        delivery_city: original.delivery_city,
        delivery_date: null, // пусть выберет новую дату
        delivery_type: original.delivery_type,
        notes: `Повтор заказа ${original.number}`,
        metadata: { repeat_of: original.id },
      })
      .select()
      .single();

    if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });

    // Создать order_items (проверяем актуальные цены)
    const productIds = (original.items || []).map((i: { product_id: string }) => i.product_id).filter(Boolean);
    let priceMap: Record<string, number> = {};
    if (productIds.length > 0) {
      const { data: products } = await supabaseAdmin.from("products").select("id, price").in("id", productIds);
      priceMap = (products || []).reduce((acc: Record<string, number>, p: { id: string; price: number }) => {
        acc[p.id] = p.price; return acc;
      }, {});
    }

    const newItems = (original.items || []).map((item: {
      product_id: string | null; product_title: string; unit_price: number; quantity: number;
      selected_attributes: Record<string, unknown> | null;
    }) => ({
      order_id: newOrder.id,
      product_id: item.product_id,
      product_title: item.product_title,
      unit_price: item.product_id && priceMap[item.product_id] ? priceMap[item.product_id] : item.unit_price,
      quantity: item.quantity,
      selected_attributes: item.selected_attributes,
      total: (item.product_id && priceMap[item.product_id] ? priceMap[item.product_id] : item.unit_price) * item.quantity,
    }));

    if (newItems.length > 0) {
      const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(newItems);
      if (itemsErr) console.warn("[orders/repeat] Items error:", itemsErr.message);
    }

    return NextResponse.json({ order: newOrder, message: `Создан повтор заказа ${original.number}` }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
