/**
 * PATCH /api/orders/[id] — обновление статуса заказа.
 *
 * Доступ:
 *   - CUSTOMER: только CANCELLED (отмена своего заказа)
 *   - CONFECTIONER: CONFIRMED, PREPARING, READY (статусы приготовления)
 *   - COURIER: IN_DELIVERY, DELIVERED
 *   - ADMIN: любой статус
 *
 * Body: { status: 'PENDING'|'CONFIRMED'|..., comment?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, forbiddenResponse, unauthorizedResponse } from "@/lib/supabase/auth";

interface OrderStatusTransition {
  from: string;
  to: string;
  roles: string[]; // роли которым разрешён переход
}

const STATUS_TRANSITIONS: OrderStatusTransition[] = [
  { from: "PENDING", to: "CONFIRMED", roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"] },
  { from: "PENDING", to: "CANCELLED", roles: ["CUSTOMER", "CONFECTIONER", "ADMIN", "SUPER_ADMIN"] },
  { from: "CONFIRMED", to: "PREPARING", roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"] },
  { from: "PREPARING", to: "READY", roles: ["CONFECTIONER", "ADMIN", "SUPER_ADMIN"] },
  { from: "READY", to: "IN_DELIVERY", roles: ["COURIER", "ADMIN", "SUPER_ADMIN"] },
  { from: "IN_DELIVERY", to: "DELIVERED", roles: ["COURIER", "ADMIN", "SUPER_ADMIN"] },
  { from: "DELIVERED", to: "COMPLETED", roles: ["CUSTOMER", "ADMIN", "SUPER_ADMIN"] },
  { from: "DELIVERED", to: "REFUNDED", roles: ["ADMIN", "SUPER_ADMIN", "INSPECTOR"] },
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const body = await request.json();
    const { status: newStatus, comment } = body as {
      status: string;
      comment?: string;
    };

    if (!newStatus) {
      return NextResponse.json({ error: "Status is required" }, { status: 400 });
    }

    // Загружаем текущий заказ
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, confectioner_id, status, number")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    // Проверяем права на переход
    const transition = STATUS_TRANSITIONS.find(
      (t) => t.from === order.status && t.to === newStatus
    );

    if (!transition) {
      return NextResponse.json(
        { error: `Запрещённый переход: ${order.status} → ${newStatus}` },
        { status: 400 }
      );
    }

    // Проверяем роль пользователя
    const userRoles = user.roles;
    const hasRole = transition.roles.some((r) => userRoles.includes(r as never));
    if (!hasRole) {
      return forbiddenResponse(`Роль ${userRoles.join(", ")} не может менять статус ${order.status} → ${newStatus}`);
    }

    // Дополнительная проверка: CUSTOMER может менять только свой заказ
    if (userRoles.includes("CUSTOMER") && !userRoles.includes("ADMIN")) {
      if (order.user_id !== user.id) {
        return forbiddenResponse("Можно менять только свои заказы");
      }
    }

    // Дополнительная проверка: CONFECTIONER может менять только свои заказы
    if (userRoles.includes("CONFECTIONER") && !userRoles.includes("ADMIN")) {
      if (order.confectioner_id !== user.id) {
        return forbiddenResponse("Можно менять только заказы, назначенные вам");
      }
    }

    // Обновляем заказ
    const updateData: Record<string, string> = { status: newStatus };
    if (comment) updateData.notes = comment;

    // Timestamps для конкретных статусов
    if (newStatus === "CONFIRMED") updateData.confirmed_at = new Date().toISOString();
    if (newStatus === "IN_DELIVERY") updateData.shipped_at = new Date().toISOString();
    if (newStatus === "DELIVERED") updateData.delivered_at = new Date().toISOString();
    if (newStatus === "COMPLETED") updateData.completed_at = new Date().toISOString();
    if (newStatus === "CANCELLED") updateData.cancelled_at = new Date().toISOString();

    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from("orders")
      .update(updateData)
      .eq("id", orderId)
      .select()
      .single();

    if (updateError) {
      console.error("[orders/[id]] Update error:", updateError.message);
      return NextResponse.json({ error: "Ошибка обновления" }, { status: 500 });
    }

    return NextResponse.json({
      order: updatedOrder,
      transition: { from: order.status, to: newStatus },
    });
  } catch (error) {
    console.error("[orders/[id]] Unexpected:", (error as Error).message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: (error as Error).message },
      { status: 500 }
    );
  }
}

/** GET /api/orders/[id] — детали заказа */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: orderId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select(`
        *,
        items:order_items(*),
        payment:payments(*),
        delivery:deliveries(*)
      `)
      .eq("id", orderId)
      .single();

    if (error || !order) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    // Проверяем права доступа
    const isOwner = order.user_id === user.id;
    const isConfectioner = order.confectioner_id === user.id;
    const isAdmin = user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "SUPPORT", "COURIER"].includes(r)
    );

    if (!isOwner && !isConfectioner && !isAdmin) {
      return forbiddenResponse("Нет доступа к этому заказу");
    }

    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
