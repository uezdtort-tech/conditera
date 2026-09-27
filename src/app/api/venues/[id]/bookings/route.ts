/**
 * GET  /api/venues/:id/bookings — брони площадки (для владельца/админа)
 * POST /api/venues/:id/bookings — создать бронь (любой аутентифицированный)
 *
 * Замена audit_log-заглушки: таблица venue_bookings (миграция 0033).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

const STATUSES = ["pending", "confirmed", "rejected", "cancelled", "completed"];

/** GET — список броней конкретной площадки. Владелец площадки или админ. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { id: venueId } = await params;

    // Площадка существует?
    const { data: venue, error: venueErr } = await supabaseAdmin
      .from("venues")
      .select("id, owner_id, name")
      .eq("id", venueId)
      .maybeSingle();

    if (venueErr || !venue) {
      return NextResponse.json({ error: "Площадка не найдена" }, { status: 404 });
    }

    const isOwner = venue.owner_id === user.id;
    const isStaff = await isStaffMember(user.id);
    if (!isOwner && !isStaff) {
      // Не владелец — отдаём только свои брони этой площадки
      const { data, error } = await supabaseAdmin
        .from("venue_bookings")
        .select("*")
        .eq("venue_id", venueId)
        .eq("user_id", user.id)
        .order("event_date", { ascending: true });
      if (error) {
        console.error("[venue-bookings] GET (own) error:", error.message);
        return NextResponse.json({ error: "Ошибка получения броней" }, { status: 500 });
      }
      return NextResponse.json({ bookings: data || [], scope: "own" });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = supabaseAdmin
      .from("venue_bookings")
      .select("*")
      .eq("venue_id", venueId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (status && STATUSES.includes(status)) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[venue-bookings] GET error:", error.message);
      return NextResponse.json({ error: "Ошибка получения броней" }, { status: 500 });
    }

    return NextResponse.json({ bookings: data || [], scope: isOwner ? "owner" : "staff" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[venue-bookings] GET unexpected:", message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

/** POST — создать бронь (публичный флоу с площадки; нужен вход). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Войдите, чтобы забронировать площадку" },
        { status: 401 }
      );
    }

    const { id: venueId } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
    }

    const { data: venue, error: venueErr } = await supabaseAdmin
      .from("venues")
      .select("id, name, is_active, price_per_hour, min_rent_hours, capacity")
      .eq("id", venueId)
      .maybeSingle();

    if (venueErr || !venue) {
      return NextResponse.json({ error: "Площадка не найдена" }, { status: 404 });
    }
    if (!venue.is_active) {
      return NextResponse.json({ error: "Площадка временно недоступна" }, { status: 409 });
    }

    // ===== Валидация =====
    const { eventDate, startTime, endTime, guests, contactName, contactPhone, message } =
      body as Record<string, unknown>;

    if (typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      return NextResponse.json(
        { error: "Дата обязательна в формате ГГГГ-ММ-ДД" },
        { status: 422 }
      );
    }
    const date = new Date(`${eventDate}T00:00:00`);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() - 86_400_000) {
      return NextResponse.json({ error: "Дата в прошлом" }, { status: 422 });
    }

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (startTime !== undefined && startTime !== null && !(typeof startTime === "string" && timeRe.test(startTime))) {
      return NextResponse.json({ error: "start_time в формате ЧЧ:ММ" }, { status: 422 });
    }
    if (endTime !== undefined && endTime !== null && !(typeof endTime === "string" && timeRe.test(endTime))) {
      return NextResponse.json({ error: "end_time в формате ЧЧ:ММ" }, { status: 422 });
    }

    // Расчёт часов + проверка минималки
    let hours: number | null = null;
    if (typeof startTime === "string" && typeof endTime === "string") {
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      const mins = eh * 60 + em - (sh * 60 + sm);
      if (mins <= 0) {
        return NextResponse.json(
          { error: "Время окончания должно быть позже начала" },
          { status: 422 }
        );
      }
      hours = Math.ceil(mins / 60);
      if (hours < (venue.min_rent_hours ?? 1)) {
        return NextResponse.json(
          { error: `Минимальный срок аренды — ${venue.min_rent_hours} ч` },
          { status: 422 }
        );
      }
    }

    const guestsNum = Number(guests);
    if (guests !== undefined && guests !== null) {
      if (!Number.isFinite(guestsNum) || guestsNum < 1 || guestsNum > (venue.capacity ?? 10000)) {
        return NextResponse.json(
          { error: `Вместимость площадки — до ${venue.capacity} гостей` },
          { status: 422 }
        );
      }
    }

    for (const [key, value] of [
      ["contact_name", contactName],
      ["contact_phone", contactPhone],
      ["message", message],
    ] as const) {
      if (value !== undefined && value !== null && typeof value !== "string") {
        return NextResponse.json({ error: `Поле «${key}» должно быть строкой` }, { status: 422 });
      }
      if (typeof value === "string" && value.length > 1000) {
        return NextResponse.json({ error: `Поле «${key}» слишком длинное` }, { status: 422 });
      }
    }

    // Конфликт: подтверждённая бронь на ту же дату с пересечением времени
    const { data: conflicts } = await supabaseAdmin
      .from("venue_bookings")
      .select("id, start_time, end_time")
      .eq("venue_id", venueId)
      .eq("event_date", eventDate)
      .in("status", ["pending", "confirmed"]);

    if (conflicts && conflicts.length) {
      const newStart = typeof startTime === "string" ? startTime : "00:00";
      const newEnd = typeof endTime === "string" ? endTime : "23:59";
      const overlaps = conflicts.some((c) => {
        const cs = c.start_time || "00:00";
        const ce = c.end_time || "23:59";
        return newStart < ce && cs < newEnd;
      });
      if (overlaps) {
        return NextResponse.json(
          { error: "Это время уже занято — выберите другое или свяжитесь с площадкой" },
          { status: 409 }
        );
      }
    }

    const insertData = {
      venue_id: venueId,
      user_id: user.id,
      event_date: eventDate,
      start_time: typeof startTime === "string" ? startTime : null,
      end_time: typeof endTime === "string" ? endTime : null,
      hours,
      guests: guests === undefined || guests === null || !Number.isFinite(guestsNum) ? null : guestsNum,
      contact_name: typeof contactName === "string" ? contactName : null,
      contact_phone: typeof contactPhone === "string" ? contactPhone : null,
      message: typeof message === "string" ? message : null,
      status: "pending",
      price_snapshot: venue.price_per_hour ?? 0,
      deposit_amount: Math.round((venue.price_per_hour ?? 0) * (hours ?? venue.min_rent_hours ?? 1) * 0.5),
    };

    const { data: created, error: insertErr } = await supabaseAdmin
      .from("venue_bookings")
      .insert(insertData)
      .select()
      .single();

    if (insertErr) {
      console.error("[venue-bookings] POST error:", insertErr.message);
      return NextResponse.json(
        { error: "Не удалось создать бронь", details: insertErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        booking: created,
        message: "Заявка на бронирование отправлена — площадка ответит в ближайшее время",
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[venue-bookings] POST unexpected:", message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

async function isStaffMember(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("role", ["ADMIN", "SUPER_ADMIN", "MODERATOR", "SUPPORT"]);
  return Boolean(data && data.length > 0);
}
