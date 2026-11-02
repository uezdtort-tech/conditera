/**
 * GET    /api/holidays — системные праздники (публично) + личные (только auth)
 * POST   /api/holidays — добавить праздник
 * DELETE /api/holidays?id=... — удалить
 *
 * Auth: GET — публичный (гостям системные праздники, user: []),
 *       POST/DELETE — AUTHENTICATED.
 *
 * Схема (первопричина бага 'user_holidays.user_id does not exist'):
 *   Роут был написан под фантомную схему (user_id/month/day/active) таблицы
 *   user_holidays. Фактически:
 *     • user_holidays (0017) — legacy mock-эпохи: camelCase колонки, userId TEXT,
 *       ни один runtime-читатель её не использует;
 *     • holiday_reminders (0010) — реальная таблица пользовательских праздников:
 *       id UUID, user_id UUID FK → auth.users, name, type, date DATE,
 *       remind_days_before, is_recurring, last_notified_at; RLS own-политики;
 *       её же читает cron /api/cron/holiday-reminders.
 *   Личные праздники храним в holiday_reminders: date = ближайшая годовщина
 *   (месяц/день из формы), is_recurring=true. GET маппит date → month/day для
 *   клиента (HolidayCalendar ждёт {id,name,month,day,remind_days_before}).
 *
 * Безопасность:
 *   • POST: парсинг JSON безопасен (safeJsonBody); валидация name/month/day/
 *     remindDaysBefore; type — из preferredCategory либо 'custom';
 *   • DELETE: ownership через .eq("user_id", user.userId) + .delete() — чужой
 *     праздник удалить нельзя (0 строк → 404);
 *   • GET: без сессии — только системные (гостевой шум не ломаем).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

const MAX_NAME_LENGTH = 100;
const MAX_REMIND_DAYS = 60;
const MIN_MONTH = 1;
const MAX_MONTH = 12;
const MIN_DAY = 1;
const MAX_DAY = 31;

const SYSTEM_HOLIDAYS = [
  { name: "Новый год", month: 1, day: 1, category: "newyear" },
  { name: "Рождество", month: 1, day: 7, category: "christmas" },
  { name: "День святого Валентина", month: 2, day: 14, category: "romantic" },
  { name: "День защитника Отечества", month: 2, day: 23, category: "mens" },
  { name: "Международный женский день", month: 3, day: 8, category: "womens" },
  { name: "День Победы", month: 5, day: 9, category: "memorial" },
  { name: "День защиты детей", month: 6, day: 1, category: "kids" },
  { name: "День России", month: 6, day: 12, category: "national" },
  { name: "День знаний", month: 9, day: 1, category: "school" },
  { name: "День матери", month: 11, day: 24, category: "family" },
  { name: "Предновогодний", month: 12, day: 31, category: "newyear" },
];

/** holiday_reminders → клиентский шейп {id,name,month,day,remind_days_before}. */
interface ReminderRow {
  id: string;
  name: string;
  type: string | null;
  date: string; // DATE 'YYYY-MM-DD'
  remind_days_before: number | null;
}

function toClientHoliday(r: ReminderRow) {
  // Шим/PG возвращают DATE как ISO-строку ('2026-03-08' или
  // '2026-03-08T00:00:00.000Z') — new Date() покрывает оба формата.
  const d = new Date(r.date);
  return {
    id: r.id,
    name: r.name,
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    remind_days_before: r.remind_days_before ?? 7,
    type: r.type,
  };
}

/** Дата ближайшей годовщины month/day (год — текущий или следующий). */
function nextOccurrenceDate(month: number, day: number): string {
  const now = new Date();
  const make = (year: number) =>
    new Date(Date.UTC(year, month - 1, Math.min(day, 28), 12));
  // 28-дневный клэмп защищает 29.02 от Date.UTC-rollover на не-високосный год
  let target = make(now.getUTCFullYear());
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (target.getTime() < todayUtc) {
    target = make(now.getUTCFullYear() + 1);
  }
  return target.toISOString().slice(0, 10);
}

interface CreateHolidayBody {
  name?: string;
  month?: number;
  day?: number;
  remindDaysBefore?: number;
  preferredCategory?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // GET публичный: системные праздники — маркетинговый контент для гостей
    // (виджет календаря на главной); личные праздники — только для владельца.
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ system: SYSTEM_HOLIDAYS, user: [] });
    }

    const { data: reminders, error } = await supabaseAdmin
      .from("holiday_reminders")
      .select("id, name, type, date, remind_days_before")
      .eq("user_id", user.userId)
      .order("date", { ascending: true }) as {
      data: ReminderRow[] | null;
      error: { message: string } | null;
    };

    if (error) {
      console.warn("[holidays] GET error:", error.message);
    }

    return NextResponse.json({
      system: SYSTEM_HOLIDAYS,
      user: (reminders || []).map(toClientHoliday),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseErr } = await safeJsonBody<CreateHolidayBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Validate name
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new HttpError(400, "name обязателен");
    }
    if (body.name.length > MAX_NAME_LENGTH) {
      throw new HttpError(422, `name слишком длинный (макс ${MAX_NAME_LENGTH})`);
    }

    // Validate month
    if (typeof body.month !== "number" || !Number.isInteger(body.month) ||
        body.month < MIN_MONTH || body.month > MAX_MONTH) {
      throw new HttpError(422, `month должен быть целым числом от ${MIN_MONTH} до ${MAX_MONTH}`);
    }

    // Validate day
    if (typeof body.day !== "number" || !Number.isInteger(body.day) ||
        body.day < MIN_DAY || body.day > MAX_DAY) {
      throw new HttpError(422, `day должен быть целым числом от ${MIN_DAY} до ${MAX_DAY}`);
    }

    // Validate remindDaysBefore
    let remindDaysBefore = 7;
    if (body.remindDaysBefore !== undefined && body.remindDaysBefore !== null) {
      if (typeof body.remindDaysBefore !== "number" || !Number.isInteger(body.remindDaysBefore) ||
          body.remindDaysBefore < 1 || body.remindDaysBefore > MAX_REMIND_DAYS) {
        throw new HttpError(422, `remindDaysBefore должен быть целым числом от 1 до ${MAX_REMIND_DAYS}`);
      }
      remindDaysBefore = body.remindDaysBefore;
    }

    const preferredCategory = typeof body.preferredCategory === "string" ? body.preferredCategory : null;

    const { data, error } = await supabaseAdmin
      .from("holiday_reminders")
      .insert({
        user_id: user.userId,
        name: body.name,
        type: preferredCategory || "custom",
        date: nextOccurrenceDate(body.month, body.day),
        remind_days_before: remindDaysBefore,
        is_recurring: true,
      })
      .select("id, name, type, date, remind_days_before")
      .single() as { data: ReminderRow | null; error: { message: string } | null };

    if (error || !data) {
      console.error("[holidays] insert failed:", error?.message);
      throw new HttpError(500, "Не удалось создать праздник");
    }
    return NextResponse.json({ holiday: toClientHoliday(data) }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) throw new HttpError(400, "Укажите id");

    // Ownership: delete строго своей строки (user_id в фильтре) — чужой
    // праздник удалить нельзя; 0 строк → 404 (id не существует или чужой).
    const { data: deleted, error } = await supabaseAdmin
      .from("holiday_reminders")
      .delete()
      .eq("id", id)
      .eq("user_id", user.userId)
      .select("id") as {
      data: { id: string }[] | null;
      error: { message: string } | null;
    };

    if (error) {
      console.error("[holidays] delete failed:", error.message);
      throw new HttpError(500, "Не удалось удалить праздник");
    }
    if (!deleted || deleted.length === 0) {
      throw new HttpError(404, "Праздник не найден");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
