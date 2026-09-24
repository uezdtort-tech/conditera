/**
 * GET    /api/holidays — список праздников пользователя + системные
 * POST   /api/holidays — добавить праздник
 * DELETE /api/holidays?id=... — удалить
 *
 * Auth: AUTHENTICATED
 *
 * Безопасность:
 *   • POST: парсинг JSON безопасен (safeJsonBody).
 *   • POST: month — целое 1-12, day — целое 1-31.
 *   • POST: name — строка 1..100 символов.
 *   • POST: remindDaysBefore — целое 1..60.
 *   • DELETE: ownership check через .eq("user_id", user.userId).
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

interface CreateHolidayBody {
  name?: string;
  month?: number;
  day?: number;
  remindDaysBefore?: number;
  preferredCategory?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: userHolidays, error } = await supabaseAdmin
      .from("user_holidays")
      .select("*")
      .eq("user_id", user.userId)
      .eq("active", true)
      .order("month", { ascending: true });

    if (error) {
      console.warn("[holidays] GET error:", error.message);
    }

    return NextResponse.json({
      system: SYSTEM_HOLIDAYS,
      user: userHolidays || [],
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
      .from("user_holidays")
      .insert({
        user_id: user.userId,
        name: body.name,
        month: body.month,
        day: body.day,
        remind_days_before: remindDaysBefore,
        preferred_category: preferredCategory,
        active: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[holidays] insert failed:", error.message);
      throw new HttpError(500, "Не удалось создать праздник");
    }
    return NextResponse.json({ holiday: data }, { status: 201 });
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

    // Ownership check через .eq("user_id", user.userId) — нельзя удалить чужой праздник
    const { error } = await supabaseAdmin
      .from("user_holidays")
      .update({ active: false })
      .eq("id", id)
      .eq("user_id", user.userId);

    if (error) {
      console.error("[holidays] delete failed:", error.message);
      throw new HttpError(500, "Не удалось удалить праздник");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
