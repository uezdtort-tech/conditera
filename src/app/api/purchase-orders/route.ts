/**
 * POST /api/purchase-orders — создание закупочного заказа (кондитер → поставщик).
 * GET  /api/purchase-orders — список СВОИХ заказов (buyer), серверный фильтр по статусу.
 *
 * POST проверяет на сервере: роль CONFECTIONER, одобрение поставщика,
 * публикацию товаров, MOQ/кратность, остаток; цена — только из БД
 * (клиентская не доверяется); резерв — атомарная транзакция.
 * Идемпотентность: заголовок Idempotency-Key (UUID) → повтор возвращает
 * существующий заказ (existing: true), двойного создания нет.
 *
 * Auth: CONFECTIONER (POST/GET свои), ADMIN/SUPER_ADMIN (GET — не реализовано
 * в v17, админ работает через карточки).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  createPurchaseOrder,
  notificationForAction,
  type CreateOrderInput,
} from "@/lib/purchase-orders";
import { sendNotification } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = (await request.json()) as Partial<CreateOrderInput> & {
      items?: { productId?: string; quantity?: number }[];
    };

    // Нормализация входа.
    const input: CreateOrderInput = {
      supplierId: String(body.supplierId ?? ""),
      items: (body.items ?? []).map((it) => ({
        productId: String(it?.productId ?? ""),
        quantity: Number(it?.quantity ?? 0),
      })),
      buyerComment: body.buyerComment,
      deliveryMethod: body.deliveryMethod === "pickup" ? "pickup" : "delivery",
      deliveryAddress: body.deliveryAddress,
      requestedDeliveryDate: body.requestedDeliveryDate,
      sourceOrderId: body.sourceOrderId,
      idempotencyKey:
        request.headers.get("idempotency-key") ?? (body as { idempotencyKey?: string }).idempotencyKey,
    };

    const result = await createPurchaseOrder(user.id, input);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, details: result.details },
        { status: result.httpStatus }
      );
    }

    // Уведомления (non-blocking): поставщику — новый заказ, кондитеру — квитанция.
    if (!result.existing) {
      try {
        const note = notificationForAction("submit", result.order.number);
        await sendNotification({
          userId: input.supplierId,
          template: note.template,
          vars: { orderNumber: result.order.number, total: result.order.subtotal / 100 },
          data: { type: "purchase_order_submitted", purchaseOrderId: result.order.id },
          dedupKey: `po-submitted:${result.order.id}`,
        });
        await sendNotification({
          userId: user.id,
          template: "ORDER_STATUS_CHANGED",
          vars: { orderNumber: result.order.number, status: "SUBMITTED" },
          data: { type: "purchase_order_created", purchaseOrderId: result.order.id },
          dedupKey: `po-created-ack:${result.order.id}`,
        });
      } catch (notifyErr) {
        console.warn("[purchase-orders] notify failed:", (notifyErr as Error).message);
      }
    }

    return NextResponse.json(
      { order: result.order, existing: result.existing ?? false },
      { status: result.existing ? 200 : 201 }
    );
  } catch (e: any) {
    console.error("[purchase-orders] POST:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = Math.min(Number(searchParams.get("limit") ?? 50) || 50, 200);

    let query = supabaseAdmin
      .from("purchase_orders")
      .select(
        `id, number, supplier_id, status, subtotal, confirmed_subtotal, currency,
         delivery_method, delivery_address, requested_delivery_date,
         promised_shipment_date, buyer_comment, supplier_comment, rejection_reason,
         created_at, updated_at, confirmed_at, rejected_at, shipped_at, delivered_at, cancelled_at,
         items:purchase_order_items(id, product_id, product_name, unit, quantity, confirmed_quantity, unit_price, line_total)`
      )
      .eq("buyer_id", user.id) // только СВОИ заказы (изоляция кондитеров)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      console.error("[purchase-orders] GET error:", error.message);
      return NextResponse.json({ error: "Ошибка чтения заказов" }, { status: 500 });
    }

    // Публичные имена поставщиков.
    const supplierIds = [...new Set((data ?? []).map((o: any) => o.supplier_id))];
    const { data: suppliers } = await supabaseAdmin
      .from("supplier_profiles")
      .select("userId, companyName")
      .in("userId", supplierIds.length ? supplierIds : ["00000000-0000-0000-0000-000000000000"]);
    const namesById = new Map((suppliers ?? []).map((s: any) => [s.userId, s.companyName]));

    const orders = (data ?? []).map((o: Record<string, unknown>) => ({
      ...o,
      supplierName: namesById.get(String(o.supplier_id)) ?? "Поставщик",
    }));

    return NextResponse.json({ orders });
  } catch (e: any) {
    console.error("[purchase-orders] GET:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
