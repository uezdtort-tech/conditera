/**
 * GET /api/notifications/preferences — получить настройки уведомлений пользователя
 * PUT /api/notifications/preferences — обновить настройки
 *
 * Если у пользователя ещё нет записи в notification_preferences —
 * создаётся дефолтная (через defaultPreferences() из @/lib/notifications).
 *
 * PUT поддерживает обновление следующих полей (camelCase → snake_case для БД):
 *   emailEnabled, smsEnabled, pushEnabled, telegramEnabled, inAppEnabled,
 *   orderUpdates, paymentUpdates, promos, messages, reviews,
 *   loyalty, abandonedCart, digest,
 *   quietHoursStart, quietHoursEnd, timezone, maxPerDay
 *
 * Auth: AUTHENTICATED (только свои настройки)
 *
 * Соответствует таблице: notification_preferences (RLS по user_id)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { defaultPreferences } from "@/lib/notifications";

export const runtime = "nodejs";

// camelCase → snake_case mapping (колонки реальной таблицы 0001 + 0059)
const CAMEL_TO_SNAKE: Record<string, string> = {
  emailEnabled: "email_enabled",
  smsEnabled: "sms_enabled",
  pushEnabled: "push_enabled",
  telegramEnabled: "telegram_enabled",
  inAppEnabled: "in_app_enabled",
  // единой колонки order_updates нет — ближайшая семантика order_status_changed
  // (гранулярность order_created/order_delivered — колонками 0001)
  orderUpdates: "order_status_changed",
  paymentUpdates: "payment_updates",
  promos: "promotions",
  messages: "new_message",
  reviews: "new_review",
  loyalty: "loyalty",
  abandonedCart: "abandoned_cart",
  digest: "weekly_digest",
  quietHoursStart: "quiet_hours_start",
  quietHoursEnd: "quiet_hours_end",
  timezone: "timezone",
  maxPerDay: "max_per_day",
};

/**
 * GET /api/notifications/preferences — получить настройки уведомлений.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { data: prefs, error } = await supabaseAdmin
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[notifications/preferences] GET error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    if (!prefs) {
      // Создать дефолтные настройки
      const defaults = defaultPreferences();
      const insertData = {
        user_id: user.id,
        email_enabled: defaults.emailEnabled,
        sms_enabled: defaults.smsEnabled,
        push_enabled: defaults.pushEnabled,
        telegram_enabled: defaults.telegramEnabled,
        in_app_enabled: defaults.inAppEnabled,
        order_status_changed: defaults.orderUpdates,
        payment_updates: defaults.paymentUpdates,
        promotions: defaults.promos,
        new_message: defaults.messages,
        new_review: defaults.reviews,
        loyalty: defaults.loyalty,
        abandoned_cart: defaults.abandonedCart,
        weekly_digest: defaults.digest,
        quiet_hours_start: defaults.quietHoursStart,
        quiet_hours_end: defaults.quietHoursEnd,
        timezone: defaults.timezone,
        max_per_day: defaults.maxPerDay,
      };

      const { data: created, error: createErr } = await supabaseAdmin
        .from("notification_preferences")
        .insert(insertData)
        .select()
        .single();

      if (createErr) {
        console.warn("[notifications/preferences] create default failed:", createErr.message);
        // Возвращаем дефолтные значения без сохранения
        return NextResponse.json({
          preferences: { user_id: user.id, ...defaults },
        });
      }

      return NextResponse.json({ preferences: created });
    }

    return NextResponse.json({ preferences: prefs });
  } catch (error: any) {
    console.error("GET /api/notifications/preferences error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * PUT|PATCH /api/notifications/preferences — обновить настройки уведомлений.
 * PATCH — алиас PUT (клиентский контракт: GET/PATCH preferences).
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // Собрать разрешённые поля в snake_case (и сохранить camelCase для
    // синхронизации с profiles.notify_prefs — фактическим источником доставки)
    const updateData: Record<string, unknown> = {};
    const camelUpdates: Record<string, unknown> = {};
    for (const [camelKey, snakeKey] of Object.entries(CAMEL_TO_SNAKE)) {
      if (body[camelKey] !== undefined) {
        updateData[snakeKey] = body[camelKey];
        camelUpdates[camelKey] = body[camelKey];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "Нет полей для обновления" },
        { status: 422 }
      );
    }

    updateData.updated_at = new Date().toISOString();

    // Upsert
    const defaults = defaultPreferences();
    const insertData: Record<string, unknown> = {
      user_id: user.id,
      email_enabled: defaults.emailEnabled,
      sms_enabled: defaults.smsEnabled,
      push_enabled: defaults.pushEnabled,
      telegram_enabled: defaults.telegramEnabled,
      in_app_enabled: defaults.inAppEnabled,
      order_status_changed: defaults.orderUpdates,
      payment_updates: defaults.paymentUpdates,
      promotions: defaults.promos,
      new_message: defaults.messages,
      new_review: defaults.reviews,
      loyalty: defaults.loyalty,
      abandoned_cart: defaults.abandonedCart,
      weekly_digest: defaults.digest,
      quiet_hours_start: defaults.quietHoursStart,
      quiet_hours_end: defaults.quietHoursEnd,
      timezone: defaults.timezone,
      max_per_day: defaults.maxPerDay,
      ...updateData,
    };

    const { data: prefs, error } = await supabaseAdmin
      .from("notification_preferences")
      .upsert(insertData, { onConflict: "user_id" })
      .select()
      .single();

    if (error) {
      console.error("[notifications/preferences] PUT error:", error.message);
      return NextResponse.json(
        { error: "Database upsert failed", details: error.message },
        { status: 500 }
      );
    }

    // Синхронизация с profiles.notify_prefs (jsonb) — именно его читает
    // sendNotification при доставке (coercePrefs). Fail-safe.
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("notify_prefs")
        .eq("id", user.id)
        .maybeSingle();
      const merged = {
        ...(((prof as { notify_prefs?: Record<string, unknown> } | null)?.notify_prefs as
          Record<string, unknown>) || {}),
        ...camelUpdates,
      };
      await supabaseAdmin.from("profiles").update({ notify_prefs: merged }).eq("id", user.id);
    } catch (e) {
      console.warn("[notifications/preferences] notify_prefs sync failed (non-blocking):", e);
    }

    return NextResponse.json({ preferences: prefs });
  } catch (error: any) {
    console.error("PUT /api/notifications/preferences error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}

/** PATCH — алиас PUT (тот же контракт обновления настроек). */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  return PUT(req);
}
