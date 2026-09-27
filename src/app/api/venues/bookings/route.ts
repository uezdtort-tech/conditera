/**
 * GET /api/venues/bookings — мои брони + входящие (для владельца)
 *
 *  - mine:     брони, созданные текущим пользователем (клиентский флоу)
 *  - incoming: брони площадок, где текущий пользователь — владелец
 *              (только для VENUE_OWNER / ADMIN)
 *
 * Замена audit_log-заглушки (миграция 0033 — таблица venue_bookings).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    // 1. Брони пользователя
    let mineQuery = supabaseAdmin
      .from("venue_bookings")
      .select(
        `id, venue_id, event_date, start_time, end_time, hours, guests, status,
         deposit_amount, deposit_paid, owner_reply, message, price_snapshot, created_at,
         venues:venue_id ( id, name, address, city, images, contacts )`
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (status) mineQuery = mineQuery.eq("status", status);

    const { data: mine, error: mineErr } = await mineQuery;
    if (mineErr) {
      console.error("[venues/bookings] mine error:", mineErr.message);
      return NextResponse.json({ error: "Ошибка получения броней" }, { status: 500 });
    }

    // 2. Роль: владелец площадки?
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .in("role", ["VENUE_OWNER", "ADMIN", "SUPER_ADMIN"]);

    let incoming: unknown[] = [];
    if (roles && roles.length) {
      const { data: myVenues } = await supabaseAdmin
        .from("venues")
        .select("id")
        .eq("owner_id", user.id);

      const venueIds = (myVenues || []).map((v) => v.id);
      if (venueIds.length) {
        let inQuery = supabaseAdmin
          .from("venue_bookings")
          .select(
            `id, venue_id, user_id, event_date, start_time, end_time, hours, guests,
             contact_name, contact_phone, message, status, deposit_amount, created_at,
             venues:venue_id ( id, name, city )`
          )
          .in("venue_id", venueIds)
          .order("created_at", { ascending: false })
          .limit(100);

        if (status) inQuery = inQuery.eq("status", status);

        const { data: incomingRows, error: inErr } = await inQuery;
        if (inErr) {
          console.error("[venues/bookings] incoming error:", inErr.message);
        } else {
          incoming = incomingRows || [];
        }
      }
    }

    return NextResponse.json({
      mine: mine || [],
      incoming,
      meta: { mineCount: mine?.length ?? 0, incomingCount: incoming.length },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[venues/bookings] GET unexpected:", message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
