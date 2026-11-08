/**
 * GET   /api/purchase-orders/[id] — карточка заказа (buyer | supplier | admin).
 * PATCH /api/purchase-orders/[id] — действия покупателя (кондитера):
 *   { action: "cancel" | "confirm_delivery" | "dispute" | "submit", comment? }
 *
 * Серверные проверки:
 *  - доступ: только buyer/supplier/admin (изоляция кондитеров и поставщиков);
 *  - действие buyer — только владельцем заказа (supplier не может cancel);
 *  - переходы статусов — по матрице ACTION_TRANSITIONS (lib/purchase-orders);
 *  - CAS: UPDATE ... WHERE status = expected → гонка даёт 409;
 *  - отмена/отказ освобождают резерв, доставка списывает остаток (атомарно).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasAnyRole } from "@/lib/role-guards";
import {
  transitionPurchaseOrder,
  notificationForAction,
  type OrderAction,
} from "@/lib/purchase-orders";
import { sendNotification } from "@/lib/notifications";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { id } = await params;
    const { data: order } = await supabaseAdmin
      .from("purchase_orders")
      .select(
        `*, items:purchase_order_items(*), history:purchase_order_status_history(*)`
      )
      .eq("id", id)
      .maybeSingle();

    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

    const isBuyer = order.buyer_id === user.id;
    const isSupplier = order.supplier_id === user.id;
    const isPrivileged = await hasAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "SUPPORT"]);
    if (!isBuyer && !isSupplier && !isPrivileged) {
      // Чужой заказ: 404 без деталей (не раскрываем существование).
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    // Публичное имя поставщика.
    const { data: supplierProfile } = await supabaseAdmin
      .from("supplier_profiles")
      .select("userId, companyName")
      .eq("userId", order.supplier_id)
      .maybeSingle();

    (order as Record<string, unknown>).viewerRole = isBuyer
      ? "buyer"
      : isSupplier
        ? "supplier"
        : "admin";
    (order as Record<string, unknown>).supplierName =
      supplierProfile?.companyName ?? "Поставщик";

    // Сортировка истории по времени.
    if (Array.isArray(order.history)) {
      (order.history as unknown[]).sort(
        (a, b) =>
          new Date((a as { created_at: string }).created_at).getTime() -
          new Date((b as { created_at: string }).created_at).getTime()
      );
    }

    return NextResponse.json({ order });
  } catch (e: any) {
    console.error("[purchase-orders/[id]] GET:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

const BUYER_ACTIONS: OrderAction[] = ["submit", "cancel", "confirm_delivery", "dispute"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { id } = await params;
    const body = (await request.json()) as { action?: string; comment?: string };
    const action = body.action as OrderAction;
    if (!action || !BUYER_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Действие недоступно покупателю: ${body.action}` },
        { status: 400 }
      );
    }
    if (action === "dispute" && !body.comment?.trim()) {
      return NextResponse.json({ error: "Опишите проблему спора" }, { status: 400 });
    }
    if (action === "cancel" && body.comment && body.comment.length > 2000) {
      return NextResponse.json({ error: "Комментарий слишком длинный" }, { status: 400 });
    }

    // Покупатель должен владеть заказом: transitionPurchaseOrder проверит
    // buyer_id == actorId через party-определение и матрицу переходов.
    // Дополнительно запрещаем admin-обход: роль здесь не источник действия.
    const result = await transitionPurchaseOrder({
      orderId: id,
      actorId: user.id,
      actorParty: "buyer",
      actorRole: "buyer",
      action,
      comment: body.comment,
      rejectionReason: action === "dispute" ? body.comment : undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, details: result.details },
        { status: result.httpStatus }
      );
    }

    // Уведомление второй стороне (non-blocking).
    try {
      const note = notificationForAction(action, result.order.number, {
        reason: body.comment,
      });
      if (result.notifiedUserId) {
        await sendNotification({
          userId: result.notifiedUserId,
          template: note.template,
          vars: { orderNumber: result.order.number, status: result.order.status },
          data: {
            type: `purchase_order_${action}`,
            purchaseOrderId: result.order.id,
            dedupKey: `po-${action}:${result.order.id}:${result.order.status}`,
          },
          dedupKey: `po-${action}:${result.order.id}:${result.order.status}`,
        });
      }
    } catch (notifyErr) {
      console.warn("[purchase-orders/[id]] notify failed:", (notifyErr as Error).message);
    }

    return NextResponse.json({ ok: true, order: result.order });
  } catch (e: any) {
    console.error("[purchase-orders/[id]] PATCH:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
