/**
 * GET  /api/tenders — список активных тендеров (AUTHENTICATED)
 * POST /api/tenders — создать тендер (CUSTOMER или CORPORATE_CLIENT)
 *
 * Query: ?mine=1&limit=
 *
 * Безопасность:
 *   • POST: требует роль CUSTOMER или CORPORATE_CLIENT.
 *   • POST: парсинг JSON безопасен (safeJsonBody).
 *   • POST: message/description — строка 1..5000 символов.
 *   • POST: guestCount — положительное целое ≤1000.
 *   • POST: budget — положительное число ≤10 000 000.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_GUEST_COUNT = 1000;
const MAX_BUDGET = 10_000_000;

interface CreateTenderBody {
  message?: string;
  description?: string;
  guestCount?: number;
  budget?: number;
  deadline?: string;
  city?: string;
}

function parsePositiveInt(value: string | null, defaultValue: number, max: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1) return defaultValue;
  return Math.min(num, max);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { searchParams } = new URL(request.url);
    const onlyMine = searchParams.get("mine") === "1";
    const limit = parsePositiveInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);

    let query = supabaseAdmin
      .from("price_inquiries")
      .select("*")
      .in("status", ["pending", "responded"])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (onlyMine) query = query.eq("user_id", user.userId);

    const { data: tenders, error } = await query;
    if (error) {
      console.warn("[tenders] GET error:", error.message);
    }

    return NextResponse.json({ tenders: tenders || [], total: (tenders || []).length });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const guard = await requireAnyRole(user.userId, ["CUSTOMER", "CORPORATE_CLIENT"]);
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    const { data: body, error: parseErr } = await safeJsonBody<CreateTenderBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Validate message (берём из message или description)
    const message =
      typeof body.message === "string" ? body.message :
      typeof body.description === "string" ? body.description : "";
    if (message.trim().length === 0) {
      throw new HttpError(400, "Укажите message или description");
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new HttpError(422, `message слишком длинный (макс ${MAX_MESSAGE_LENGTH})`);
    }

    // Validate guestCount
    let guestCount: number | null = null;
    if (body.guestCount !== undefined && body.guestCount !== null) {
      if (typeof body.guestCount !== "number" || !Number.isInteger(body.guestCount) || body.guestCount < 1) {
        throw new HttpError(422, "guestCount должен быть положительным целым числом");
      }
      if (body.guestCount > MAX_GUEST_COUNT) {
        throw new HttpError(422, `guestCount слишком большой (макс ${MAX_GUEST_COUNT})`);
      }
      guestCount = body.guestCount;
    }

    // Validate budget
    let budget: number | null = null;
    if (body.budget !== undefined && body.budget !== null) {
      if (typeof body.budget !== "number" || !Number.isFinite(body.budget) || body.budget < 0) {
        throw new HttpError(422, "budget должен быть неотрицательным числом");
      }
      if (body.budget > MAX_BUDGET) {
        throw new HttpError(422, `budget слишком большой (макс ${MAX_BUDGET})`);
      }
      budget = body.budget;
    }

    const deadline = typeof body.deadline === "string" ? body.deadline : null;
    const city = typeof body.city === "string" ? body.city : null;

    const { data: tender, error } = await supabaseAdmin
      .from("price_inquiries")
      .insert({
        user_id: user.userId,
        message,
        guest_count: guestCount,
        budget,
        deadline,
        city,
        status: "pending",
        responses_count: 0,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[tenders] insert failed:", error.message);
      throw new HttpError(500, "Не удалось создать тендер");
    }
    return NextResponse.json({ tender }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
