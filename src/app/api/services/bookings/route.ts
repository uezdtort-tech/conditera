/**
 * GET  /api/services/bookings — мои брони (как клиент) + входящие (как провайдер).
 * POST /api/services/bookings — создать бронь услуги (service_products, 0029).
 *
 * POST-флоу: auth → zod-валидация → чтение услуги (provider_id, price) →
 * insert в service_bookings (статус 'pending') → n8n service.booking.created
 * (fail-safe).
 *
 * Auth: AUTHENTICATED (бронь создаёт владелец токена).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { emitEvent } from "@/lib/n8n";

export const runtime = "nodejs";

const createBookingSchema = z.object({
  serviceProductId: z.string().uuid("serviceProductId должен быть UUID"),
  bookingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "bookingDate в формате YYYY-MM-DD"),
  startTime: z.string().max(32).optional(),
  endTime: z.string().max(32).optional(),
  address: z.string().max(500).optional(),
  comment: z.string().max(2000).optional(),
});

/** GET — брони текущего пользователя (mine) и входящие к нему как провайдеру (incoming). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const selectList =
      "id, service_product_id, user_id, provider_id, booking_date, start_time, " +
      "end_time, address, comment, status, price, order_id, created_at, updated_at";

    let mineQuery = supabaseAdmin
      .from("service_bookings")
      .select(selectList)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (status) mineQuery = mineQuery.eq("status", status);

    const { data: mine, error: mineErr } = await mineQuery;
    if (mineErr) {
      console.error("[services/bookings] mine error:", mineErr.message);
      return NextResponse.json({ error: "Ошибка получения броней" }, { status: 500 });
    }

    // Входящие: провайдер услуг видит брони своих объявлений
    let incoming: unknown[] = [];
    const { data: incomingRows, error: inErr } = await supabaseAdmin
      .from("service_bookings")
      .select(selectList)
      .eq("provider_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (inErr) {
      console.error("[services/bookings] incoming error:", inErr.message);
    } else {
      incoming = incomingRows || [];
    }

    return NextResponse.json({
      mine: mine || [],
      incoming,
      meta: { mineCount: mine?.length ?? 0, incomingCount: incoming.length },
    });
  } catch (error: unknown) {
    console.error(
      "[services/bookings] GET unexpected:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

/** POST — создать бронь услуги. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ошибка валидации", details: z.treeifyError(parsed.error) },
        { status: 400 }
      );
    }
    const { serviceProductId, bookingDate, startTime, endTime, address, comment } =
      parsed.data;

    // Услуга должна существовать и быть активной
    const { data: service, error: serviceErr } = await supabaseAdmin
      .from("service_products")
      .select("id, provider_id, price, title, is_active")
      .eq("id", serviceProductId)
      .maybeSingle();

    if (serviceErr) {
      console.error("[services/bookings] service lookup error:", serviceErr.message);
      return NextResponse.json({ error: "Ошибка чтения услуги" }, { status: 500 });
    }
    if (!service || service.is_active === false) {
      return NextResponse.json({ error: "Услуга не найдена" }, { status: 404 });
    }

    const { data: booking, error: insertErr } = await supabaseAdmin
      .from("service_bookings")
      .insert({
        service_product_id: service.id,
        user_id: user.id,
        provider_id: service.provider_id,
        booking_date: bookingDate,
        start_time: startTime ?? null,
        end_time: endTime ?? null,
        address: address ?? null,
        comment: comment ?? null,
        // price храним как в service_products (копейки), snapshot на момент брони
        price: Number(service.price) || 0,
        status: "pending",
      })
      .select()
      .single();

    if (insertErr || !booking) {
      console.error("[services/bookings] insert error:", insertErr?.message);
      return NextResponse.json({ error: "Не удалось создать бронь" }, { status: 500 });
    }

    // n8n: service.booking.created (fail-safe, после успешной записи)
    void emitEvent("service.booking.created", {
      bookingId: booking.id,
      serviceProductId: service.id,
      providerId: service.provider_id,
      userId: user.id,
      bookingDate,
    }).catch(() => {});

    return NextResponse.json({ booking }, { status: 201 });
  } catch (error: unknown) {
    console.error(
      "[services/bookings] POST unexpected:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
