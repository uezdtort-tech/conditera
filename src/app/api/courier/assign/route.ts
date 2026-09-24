/**
 * POST /api/courier/assign — назначить курьера на заказ.
 *
 * Тело запроса: { orderId: string }
 *
 * Атомарно: только заказ без курьера в статусе READY/IN_DELIVERY.
 * Два курьера не смогут взять один и тот же заказ одновременно
 * (через .update().is("courier_id", null) — optimistic lock).
 *
 * После назначения: статус меняется на IN_DELIVERY, инкрементируется
 * deliveries_count в courier_profiles.
 *
 * Auth: COURIER role.
 *
 * Соответствует таблицам:
 *  - orders (атомарное обновление courier_id, status)
 *  - courier_profiles (инкремент deliveries_count)
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

    // Атомарное обновление: только заказ без курьера в статусе READY/IN_DELIVERY.
    // Используем update + eq().is() для optimistic lock.
    // Возвращаем обновлённую запись для проверки count.
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("orders")
      .update({
        courier_id: courierId,
        status: "IN_DELIVERY",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .is("courier_id", null)
      .in("status", ["READY", "IN_DELIVERY"])
      .select("id, number")
      .maybeSingle();

    if (updateErr) {
      console.error("[courier/assign] update error:", updateErr.message);
      return NextResponse.json(
        { error: "Database update failed", details: updateErr.message },
        { status: 500 }
      );
    }

    // Если updated === null — значит условие не выполнилось (заказ уже занят)
    if (!updated) {
      return NextResponse.json(
        {
          error: "Заказ уже занят другим курьером, доставлен или не найден",
        },
        { status: 409 }
      );
    }

    // Инкремент deliveries_count в courier_profiles (non-blocking)
    try {
      // Получить текущее значение
      const { data: profile } = await supabaseAdmin
        .from("courier_profiles")
        .select("id, deliveries_count")
        .eq("user_id", courierId)
        .maybeSingle();

      if (profile) {
        await supabaseAdmin
          .from("courier_profiles")
          .update({
            deliveries_count: (profile.deliveries_count || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", profile.id);
      }
    } catch (e: any) {
      console.warn("[courier/assign] courier_profiles update failed:", e?.message);
    }

    return NextResponse.json({
      success: true,
      orderId: updated.id,
      orderNumber: updated.number,
      courierId,
    });
  } catch (error: any) {
    console.error("POST /api/courier/assign error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
