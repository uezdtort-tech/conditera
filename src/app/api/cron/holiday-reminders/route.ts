/**
 * POST /api/cron/holiday-reminders
 * Проверяет праздники и отправляет push-уведомления за N дней до события.
 *
 * Запускается по cron (n8n) ежедневно в 10:00.
 *
 * Логика:
 *   1. Загрузить все активные пользовательские праздники (holiday_reminders)
 *   2. Для каждого — проверить, наступает ли праздник через remindDaysBefore дней
 *   3. Не отправлять повторно в тот же день (по last_notified_at)
 *   4. Проверить системные праздники — за 7 дней до уведомить всех
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 *
 * Соответствует таблицам:
 *  - holiday_reminders (пользовательские праздники)
 *  - profiles (для системных праздников — отправка всем)
 *  - notifications (HOLIDAY_REMINDER template)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

interface SystemHoliday {
  name: string;
  month: number;  // 1-12
  day: number;     // 1-31
}

const SYSTEM_HOLIDAYS: SystemHoliday[] = [
  { name: "Новый год", month: 1, day: 1 },
  { name: "День святого Валентина", month: 2, day: 14 },
  { name: "Международный женский день", month: 3, day: 8 },
  { name: "День защиты детей", month: 6, day: 1 },
  { name: "День знаний", month: 9, day: 1 },
  { name: "Предновогодний", month: 12, day: 31 },
];

const SYSTEM_REMIND_DAYS_BEFORE = 7;

interface HolidayReminder {
  id: string;
  user_id: string;
  name: string;
  month: number;
  day: number;
  remind_days_before: number;
  preferred_category?: string | null;
  active: boolean;
  last_notified_at: string | null;
}

/**
 * POST /api/cron/holiday-reminders — отправить напоминания о праздниках.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const now = new Date();
    let notificationsSent = 0;

    // 1. Загрузить активные пользовательские праздники
    const { data: userHolidays, error: holidaysErr } = await supabaseAdmin
      .from("holiday_reminders")
      .select("*")
      .eq("active", true);

    if (holidaysErr) {
      console.warn("[cron/holiday-reminders] query error (non-fatal):", holidaysErr.message);
    }

    const holidays = (userHolidays || []) as unknown as HolidayReminder[];

    // 2. Обработать каждый пользовательский праздник
    for (const holiday of holidays) {
      // Целевая дата в этом году
      const targetDate = new Date(now.getFullYear(), holiday.month - 1, holiday.day);
      const daysUntil = Math.ceil(
        (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Проверяем — наступает ли праздник через remind_days_before дней
      if (daysUntil !== holiday.remind_days_before) continue;

      // Проверяем — не отправляли ли уже сегодня
      if (holiday.last_notified_at) {
        const lastNotified = new Date(holiday.last_notified_at);
        if (lastNotified.toDateString() === now.toDateString()) continue;
      }

      // Отправляем уведомление
      try {
        const { sendNotification } = await import("@/lib/notifications");
        await sendNotification({
          userId: holiday.user_id,
          template: "HOLIDAY_REMINDER",
          vars: {
            holidayName: holiday.name,
            daysUntil,
          },
          data: {
            type: "holiday_reminder",
            holidayId: holiday.id,
            preferredCategory: holiday.preferred_category,
          },
        });

        // Обновить last_notified_at
        await supabaseAdmin
          .from("holiday_reminders")
          .update({ last_notified_at: now.toISOString() })
          .eq("id", holiday.id);

        notificationsSent++;
      } catch (notifErr: any) {
        console.warn(
          `[cron/holiday-reminders] failed for holiday ${holiday.id} (non-fatal):`,
          notifErr?.message
        );
      }
    }

    // 3. Проверить системные праздники — за 7 дней до отправить всем
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();

    for (const sysHoliday of SYSTEM_HOLIDAYS) {
      // Уведомляем за SYSTEM_REMIND_DAYS_BEFORE дней до праздника
      const targetDate = new Date(now.getFullYear(), sysHoliday.month - 1, sysHoliday.day);
      const daysUntil = Math.ceil(
        (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntil !== SYSTEM_REMIND_DAYS_BEFORE) continue;

      // Получить всех активных пользователей
      const { data: users, error: usersErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("is_blocked", false);

      if (usersErr || !users) {
        console.warn("[cron/holiday-reminders] users query failed:", usersErr?.message);
        continue;
      }

      // Отправить пуш каждому (последовательно, чтобы не перегружать систему)
      for (const user of users) {
        try {
          const { sendNotification } = await import("@/lib/notifications");
          await sendNotification({
            userId: user.id,
            template: "HOLIDAY_REMINDER",
            vars: {
              holidayName: sysHoliday.name,
              daysUntil: SYSTEM_REMIND_DAYS_BEFORE,
            },
            data: { type: "system_holiday" },
          });
          notificationsSent++;
        } catch {
          // silent fail — один пользователь не должен блокировать остальных
        }
      }
    }

    return NextResponse.json({
      success: true,
      notificationsSent,
      processedAt: now.toISOString(),
    });
  } catch (error: any) {
    console.error("POST /api/cron/holiday-reminders unexpected:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
