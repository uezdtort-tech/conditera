/**
 * POST /api/courier/location — обновить геопозицию курьера.
 *
 * Тело запроса: { lat: number, lng: number, heading?: number }
 *
 * Сохраняет текущую позицию в courier_locations (одна строка на курьера,
 * unique-индекс courier_locations_courierId_key).
 * Также добавляет точку в order_tracking для активного заказа (если есть).
 *
 * Auth: COURIER role.
 *
 * P1 (courier-schema): фактические колонки — camelCase (courierId, orderId,
 * updatedAt, timestamp) — код раньше ссылался на courier_id/updated_at и
 * колонку orders.courier_id, которой в схеме нет → 500 на каждом запросе.
 * Активный заказ берётся из серверных данных: deliveries.courier_id →
 * orders.status = IN_DELIVERY. Клиентский payload orderId не принимается.
 *
 * Соответствует таблицам:
 *  - courier_locations (upsert текущей позиции)
 *  - deliveries + orders (активная доставка)
 *  - order_tracking (вставка точки трекинга)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface LocationRequestBody {
  lat: number;
  lng: number;
  heading?: number;
}

/**
 * POST /api/courier/location — обновить геопозицию курьера.
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

    const body = (await request.json()) as LocationRequestBody;
    const { lat, lng, heading } = body ?? {};

    // Валидация координат
    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json(
        { error: "lat и lng обязательны и должны быть числами" },
        { status: 400 }
      );
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json(
        { error: "lat должен быть в [-90, 90], lng в [-180, 180]" },
        { status: 400 }
      );
    }

    const courierId = user.id;

    // P1 (courier-schema): courier_locations в camelCase (courierId, updatedAt);
    // upsert через onConflict("courier_id") падал 42703. Select → update/insert.
    const nowIso = new Date().toISOString();
    const { data: existingLoc } = await supabaseAdmin
      .from("courier_locations")
      .select("id")
      .eq("courierId", courierId)
      .maybeSingle() as { data: { id: string } | null };

    const locPayload = { lat, lng, heading: heading ?? null, updatedAt: nowIso };
    const locErr = existingLoc
      ? (await supabaseAdmin
          .from("courier_locations")
          .update(locPayload)
          .eq("id", existingLoc.id)).error
      : (await supabaseAdmin
          .from("courier_locations")
          .insert({ id: crypto.randomUUID(), courierId, ...locPayload })).error;

    if (locErr) {
      console.error("[courier/location] upsert error:", locErr.message);
      return NextResponse.json(
        { error: "Ошибка при обновлении позиции", details: locErr.message },
        { status: 500 }
      );
    }

    // Если у курьера есть активная доставка — добавить точку трекинга.
    // Активный заказ — из серверных данных (deliveries.courier_id →
    // orders.status IN_DELIVERY), не из клиентского payload.
    try {
      const { data: myDeliveries } = await supabaseAdmin
        .from("deliveries")
        .select("order_id")
        .eq("courier_id", courierId) as { data: { order_id: string }[] | null };
      const orderIds = [...new Set((myDeliveries || []).map((d) => d.order_id))];

      let activeOrder: { id: string } | null = null;
      if (orderIds.length > 0) {
        const { data: found } = await supabaseAdmin
          .from("orders")
          .select("id")
          .in("id", orderIds)
          .eq("status", "IN_DELIVERY")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle() as { data: { id: string } | null };
        activeOrder = found;
      }

      if (activeOrder) {
        const { error: trackErr } = await supabaseAdmin
          .from("order_tracking")
          .insert({
            id: crypto.randomUUID(),
            orderId: activeOrder.id,
            courierId,
            lat,
            lng,
            heading: heading ?? null,
            timestamp: nowIso,
          });

        if (trackErr) {
          console.warn("[courier/location] order_tracking insert failed:", trackErr.message);
        }
      }
    } catch (e: any) {
      console.warn("[courier/location] order_tracking insert failed:", e?.message);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST /api/courier/location error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
