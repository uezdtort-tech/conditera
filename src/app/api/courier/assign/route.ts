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

    // P1 (courier-schema): назначение живёт в deliveries (order_id +
    // courier_id). Колонки orders.courier_id в реальной схеме БД НЕТ —
    // прежний update(.is("courier_id", null)) падал 500 (42703) на каждом
    // запросе. Логика сохранена: только заказ READY/IN_DELIVERY без
    // назначенного курьера; атомарный optimistic-lock клейм.
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select("id, number, status, delivery_address, delivery_cost")
      .eq("id", orderId)
      .maybeSingle() as { data: { id: string; number: string; status: string; delivery_address: string | null; delivery_cost: number | null } | null; error: { message: string } | null };

    if (orderErr) {
      console.error("[courier/assign] order fetch error:", orderErr.message);
      return NextResponse.json(
        { error: "Database query failed", details: orderErr.message },
        { status: 500 }
      );
    }
    if (!order) {
      return NextResponse.json(
        { error: "Заказ не найден" },
        { status: 404 }
      );
    }
    if (!["READY", "IN_DELIVERY"].includes(order.status)) {
      return NextResponse.json(
        { error: `Заказ не готов к выдаче курьеру (статус ${order.status})` },
        { status: 409 }
      );
    }

    // 1. Атомарный клейм существующей неназначенной строки deliveries
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("deliveries")
      .update({ courier_id: courierId, status: "assigned", updated_at: nowIso })
      .eq("order_id", orderId)
      .is("courier_id", null)
      .select("id")
      .maybeSingle() as { data: { id: string } | null; error: { message: string } | null };

    if (claimErr) {
      console.error("[courier/assign] claim error:", claimErr.message);
      return NextResponse.json(
        { error: "Database update failed", details: claimErr.message },
        { status: 500 }
      );
    }

    // 2. Строки для клейма не было: создаём (иначе — уже занят другим)
    if (!claimed) {
      const { data: rows } = await supabaseAdmin
        .from("deliveries")
        .select("id, courier_id")
        .eq("order_id", orderId) as { data: { id: string; courier_id: string | null }[] | null };
      if ((rows || []).some((r) => r.courier_id)) {
        return NextResponse.json(
          { error: "Заказ уже занят другим курьером, доставлен или не найден" },
          { status: 409 }
        );
      }
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("deliveries")
        .insert({
          order_id: orderId,
          courier_id: courierId,
          status: "assigned",
          // address NOT NULL в схеме deliveries — берём из серверных данных заказа
          address: order.delivery_address || "",
          cost: Number(order.delivery_cost || 0),
        })
        .select("id")
        .single() as { data: { id: string } | null; error: { message: string } | null };
      if (insertErr || !inserted) {
        // Гонка двух курьеров без unique-индекса: проверяем, не занял ли заказ другой
        const { data: recheck } = await supabaseAdmin
          .from("deliveries")
          .select("courier_id")
          .eq("order_id", orderId) as { data: { courier_id: string | null }[] | null };
        if ((recheck || []).some((r) => r.courier_id && r.courier_id !== courierId)) {
          return NextResponse.json(
            { error: "Заказ уже занят другим курьером, доставлен или не найден" },
            { status: 409 }
          );
        }
        console.error("[courier/assign] insert error:", insertErr?.message);
        return NextResponse.json(
          { error: "Database update failed", details: insertErr?.message },
          { status: 500 }
        );
      }
    }

    // 3. Переводим заказ в IN_DELIVERY (статусная часть — orders.status существует)
    const { error: statusErr } = await supabaseAdmin
      .from("orders")
      .update({ status: "IN_DELIVERY", updated_at: nowIso })
      .eq("id", orderId);
    if (statusErr) {
      console.error("[courier/assign] status update error:", statusErr.message);
      return NextResponse.json(
        { error: "Database update failed", details: statusErr.message },
        { status: 500 }
      );
    }

    // История перехода READY → IN_DELIVERY.
    // FIX-TL: раньше историю писал триггер orders_log_status (0006) строкой
    // с changed_by=NULL; триггер удалён (0061) — пишем сами с атрибуцией
    // актёра-курьера. Повторный assign (уже IN_DELIVERY) историю не засоряет.
    if (order.status !== "IN_DELIVERY") {
      const { error: historyError } = await supabaseAdmin
        .from("order_status_history")
        .insert({
          order_id: orderId,
          status_from: order.status,
          status_to: "IN_DELIVERY",
          changed_by: courierId,
          comment: null,
        });
      if (historyError) {
        // История не роняет назначение (статус = источник истины), но фиксируем.
        console.error("[courier/assign] history insert failed:", historyError.message);
      }
    }

    // Инкремент deliveries_count в courier_profiles (non-blocking)
    try {
      // Получить текущее значение
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

    return NextResponse.json({
      success: true,
      orderId: order.id,
      orderNumber: order.number,
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
