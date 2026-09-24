/**
 * POST /api/courier/location — обновить геопозицию курьера.
 *
 * Тело запроса: { lat: number, lng: number, heading?: number }
 *
 * Сохраняет текущую позицию в courier_locations (upsert по courier_id).
 * Также добавляет точку в order_tracking для активного заказа (если есть).
 *
 * Auth: COURIER role.
 *
 * Соответствует таблицам:
 *  - courier_locations (upsert текущей позиции)
 *  - orders (поиск активного заказа со status=IN_DELIVERY)
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

    // Upsert текущей позиции курьера (через upsert с onConflict по courier_id)
    const { error: upsertErr } = await supabaseAdmin
      .from("courier_locations")
      .upsert(
        {
          courier_id: courierId,
          lat,
          lng,
          heading: heading ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "courier_id" }
      );

    if (upsertErr) {
      console.error("[courier/location] upsert error:", upsertErr.message);
      return NextResponse.json(
        { error: "Ошибка при обновлении позиции", details: upsertErr.message },
        { status: 500 }
      );
    }

    // Если у курьера есть активный заказ в доставке — добавить точку трекинга
    try {
      const { data: activeOrder, error: orderErr } = await supabaseAdmin
        .from("orders")
        .select("id")
        .eq("courier_id", courierId)
        .eq("status", "IN_DELIVERY")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!orderErr && activeOrder) {
        const { error: trackErr } = await supabaseAdmin
          .from("order_tracking")
          .insert({
            order_id: activeOrder.id,
            courier_id: courierId,
            lat,
            lng,
            heading: heading ?? null,
            created_at: new Date().toISOString(),
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
