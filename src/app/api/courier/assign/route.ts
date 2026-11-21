/**
 * POST /api/courier/assign — назначить курьера на заказ.
 *
 * Тело запроса: { orderId: string }
 *
 * Атомарно: только заказ IN_DELIVERY, переданный кондитером.
 * Назначение записывается в deliveries через RPC с SELECT FOR UPDATE;
 * повторный запрос того же курьера идемпотентен.
 *
 * Auth: COURIER role.
 *
 * Соответствует таблицам:
 *  - deliveries (назначение курьера)
 *  - orders (номер заказа и статус handoff)
 *  - courier_profiles (счётчик доставок)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface AssignRequestBody {
  orderId: string;
}

/**
 * POST /api/courier/assign — назначить курьера на заказ.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Проверка роли — только COURIER
    const guard = await requireRole(user.id, "COURIER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = (await request.json()) as AssignRequestBody;
    const { orderId } = body;

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "Укажите orderId" },
        { status: 400 }
      );
    }

    const courierId = user.id;

    // Источник назначения — deliveries.courier_id. RPC блокирует строку
    // заказа FOR UPDATE, проверяет IN_DELIVERY и идемпотентно создаёт delivery.
    const { data: assignment, error: assignError } = await supabaseAdmin.rpc(
      "assign_order_delivery",
      { p_order_id: orderId, p_courier_id: courierId }
    );

    if (assignError) {
      const message = assignError.message || "Delivery assignment failed";
      const status =
        message.includes("ORDER_NOT_FOUND") ? 404 :
        message.includes("DELIVERY_NOT_REQUIRED") || message.includes("DELIVERY_ADDRESS_REQUIRED") ? 422 :
        message.includes("ORDER_NOT_HANDED_OFF") || message.includes("ORDER_ALREADY_ASSIGNED") ? 409 : 500;
      if (status === 500) console.error("[courier/assign] RPC failed:", message);
      return NextResponse.json({ error: message }, { status });
    }

    const result = Array.isArray(assignment) ? assignment[0] : assignment;
    if (!result?.delivery_id) {
      return NextResponse.json({ error: "Не удалось создать назначение доставки" }, { status: 500 });
    }

    // Счётчик увеличиваем только при новом назначении; повторный запрос
    // того же курьера возвращает существующую доставку без повторного инкремента.
    if (result.created) {
      try {
        const { data: profile } = await supabaseAdmin
          .from("courier_profiles")
          .select("id, deliveriesCount")
          .eq("userId", courierId)
          .maybeSingle();
        if (profile) {
          await supabaseAdmin
            .from("courier_profiles")
            .update({
              deliveriesCount: (profile.deliveriesCount || 0) + 1,
              updatedAt: new Date().toISOString(),
            })
            .eq("id", profile.id);
        }
      } catch (e: any) {
        console.warn("[courier/assign] courier_profiles update failed:", e?.message);
      }
    }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("number")
      .eq("id", orderId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      deliveryId: result.delivery_id,
      orderId: result.order_id,
      orderNumber: order?.number ?? null,
      courierId: result.courier_id,
      created: Boolean(result.created),
    });
  } catch (error: any) {
    console.error("POST /api/courier/assign error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
