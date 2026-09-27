/**
 * PATCH /api/venues/:id/bookings/:bookingId — изменение статуса брони
 *
 *  - Владелец площадки / админ: confirm | reject | complete + owner_reply
 *  - Автор брони: только cancel
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

const OWNER_TRANSITIONS = ["confirmed", "rejected", "completed"] as const;
const CUSTOMER_TRANSITIONS = ["cancelled"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { id: venueId, bookingId } = await params;
    const body = await request.json().catch(() => null);
    const status = body?.status as string | undefined;
    const ownerReply = body?.owner_reply as string | undefined;

    if (!status) {
      return NextResponse.json({ error: "Укажите status" }, { status: 422 });
    }

    const { data: booking, error: bkErr } = await supabaseAdmin
      .from("venue_bookings")
      .select("*")
      .eq("id", bookingId)
      .eq("venue_id", venueId)
      .maybeSingle();

    if (bkErr || !booking) {
      return NextResponse.json({ error: "Бронь не найдена" }, { status: 404 });
    }

    const { data: venue } = await supabaseAdmin
      .from("venues")
      .select("owner_id, name")
      .eq("id", venueId)
      .maybeSingle();

    const isOwner = venue?.owner_id === user.id;
    const isAuthor = booking.user_id === user.id;

    const { data: staffRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .in("role", ["ADMIN", "SUPER_ADMIN"]);
    const isStaff = Boolean(staffRoles && staffRoles.length);

    if (!isOwner && !isAuthor && !isStaff) {
      return NextResponse.json({ error: "Нет доступа к этой брони" }, { status: 403 });
    }

    const allowed = isAuthor && !isOwner && !isStaff
      ? CUSTOMER_TRANSITIONS
      : [...OWNER_TRANSITIONS, ...CUSTOMER_TRANSITIONS];

    if (!(allowed as readonly string[]).includes(status)) {
      return NextResponse.json(
        { error: `Недопустимый статус «${status}» для вашей роли` },
        { status: 422 }
      );
    }

    const updateData: Record<string, unknown> = { status };
    if (ownerReply !== undefined) {
      if (typeof ownerReply !== "string" || ownerReply.length > 1000) {
        return NextResponse.json({ error: "owner_reply — строка до 1000 символов" }, { status: 422 });
      }
      updateData.owner_reply = ownerReply;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("venue_bookings")
      .update(updateData)
      .eq("id", bookingId)
      .select()
      .single();

    if (updErr) {
      console.error("[venue-bookings] PATCH error:", updErr.message);
      return NextResponse.json({ error: "Не удалось обновить бронь" }, { status: 500 });
    }

    return NextResponse.json({ booking: updated, message: `Статус брони: ${status}` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[venue-bookings] PATCH unexpected:", message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
