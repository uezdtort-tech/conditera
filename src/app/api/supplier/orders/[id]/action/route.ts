/**
 * POST /api/supplier/orders/[id]/action — обработка закупочного заказа поставщиком.
 *
 * Body: { action, comment?, reason?, promisedShipmentDate?, confirmedItems? }
 *   confirm            SUBMITTED → CONFIRMED
 *                      + опциональная корректировка количеств confirmedItems:
 *                      [{ itemId, quantity }] (0..quantity); излишек резерва
 *                      освобождается в той же транзакции; согласование фиксируется
 *                      (confirmed_quantity, confirmed_subtotal) — вторая сторона
 *                      видит изменение, «тихих» правок суммы нет.
 *   reject             SUBMITTED → REJECTED (reason обязательна, резерв освобождается)
 *   process            CONFIRMED → PROCESSING
 *   ready_for_shipment PROCESSING → READY_FOR_SHIPMENT (promisedShipmentDate?)
 *   ship               READY_FOR_SHIPMENT → SHIPPED
 *   dispute            CONFIRMED|PROCESSING|READY_FOR_SHIPMENT|SHIPPED → DISPUTED (comment)
 *
 * Серверная изоляция: только supplier_id = user.id; CAS по статусу;
 * конкурентные переходы → 409. Кондитер не может вызвать supplier-действия.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import {
  transitionPurchaseOrder,
  notificationForAction,
  type OrderAction,
} from "@/lib/purchase-orders";
import { sendNotification } from "@/lib/notifications";

export const runtime = "nodejs";

const SUPPLIER_ACTIONS: OrderAction[] = [
  "confirm",
  "reject",
  "process",
  "ready_for_shipment",
  "ship",
  "dispute",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { id } = await params;
    const body = (await request.json()) as {
      action?: string;
      comment?: string;
      reason?: string;
      promisedShipmentDate?: string;
      confirmedItems?: { itemId?: string; quantity?: number }[];
    };
    const action = body.action as OrderAction;
    if (!action || !SUPPLIER_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Действие недоступно поставщику: ${body.action}` },
        { status: 400 }
      );
    }
    if (action === "reject" && (!body.reason || body.reason.trim().length < 10)) {
      return NextResponse.json(
        { error: "Укажите причину отказа (минимум 10 символов)" },
        { status: 400 }
      );
    }
    if (action === "dispute" && !body.comment?.trim()) {
      return NextResponse.json({ error: "Опишите проблему спора" }, { status: 400 });
    }
    if (action === "ready_for_shipment" && body.promisedShipmentDate) {
      const d = new Date(body.promisedShipmentDate);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Некорректная дата отгрузки" }, { status: 400 });
      }
    }

    const confirmedItems = (body.confirmedItems ?? [])
      .filter((c) => c?.itemId && Number.isInteger(Number(c.quantity)))
      .map((c) => ({ itemId: String(c.itemId), quantity: Number(c.quantity) }));

    const result = await transitionPurchaseOrder({
      orderId: id,
      actorId: user.id,
      actorParty: "supplier",
      actorRole: "supplier",
      action,
      comment: body.comment,
      rejectionReason: action === "reject" ? body.reason : undefined,
      promisedShipmentDate: body.promisedShipmentDate,
      confirmedItems: action === "confirm" ? confirmedItems : undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, details: result.details },
        { status: result.httpStatus }
      );
    }

    // Уведомление кондитеру (non-blocking, dedupKey от повторов).
    try {
      const note = notificationForAction(action, result.order.number, {
        reason: body.reason ?? body.comment,
      });
      if (result.notifiedUserId) {
        await sendNotification({
          userId: result.notifiedUserId,
          template: note.template,
          vars: { orderNumber: result.order.number, status: result.order.status },
          data: {
            type: `purchase_order_${action}`,
            purchaseOrderId: result.order.id,
          },
          dedupKey: `po-${action}:${result.order.id}:${result.order.status}`,
        });
      }
    } catch (notifyErr) {
      console.warn("[supplier/orders/action] notify failed:", (notifyErr as Error).message);
    }

    return NextResponse.json({ ok: true, order: result.order });
  } catch (e: any) {
    console.error("[supplier/orders/action]:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
