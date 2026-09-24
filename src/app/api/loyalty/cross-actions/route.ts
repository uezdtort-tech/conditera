/**
 * /api/loyalty/cross-actions/route.ts — CRUD для кросс-акций с партнёрами.
 *
 * GET  /api/loyalty/cross-actions  — список активных акций (public)
 * POST /api/loyalty/cross-actions  — создать акцию (только LOYALTY_PARTNER)
 *
 * Query параметры для GET:
 *  - partner_id     — фильтр по партнёру
 *  - discount_type  — percent | fixed | bonus_points | freebie
 *  - active_only    — true (по умолчанию) — только активные акции
 *  - limit          — по умолчанию 20, макс 100
 *  - offset         — по умолчанию 0
 *
 * Права:
 *  GET  — public
 *  POST — LOYALTY_PARTNER (только для своих компаний)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import type { LoyaltyCrossAction } from "@/lib/supabase/types";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const VALID_DISCOUNT_TYPES = [
  "percent",
  "fixed",
  "bonus_points",
  "freebie",
] as const;
type DiscountType = (typeof VALID_DISCOUNT_TYPES)[number];

/**
 * GET /api/loyalty/cross-actions — список активных акций.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const partnerId = searchParams.get("partner_id");
    const discountType = searchParams.get("discount_type") as DiscountType | null;
    const activeOnly = searchParams.get("active_only") !== "false"; // default true
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabaseAdmin
      .from("loyalty_cross_actions")
      .select(
        `
        id, partner_id, title, description, discount_type, discount_value,
        start_at, end_at, usage_limit, usage_count, is_active
      `
      )
      .order("start_at", { ascending: false });

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    if (partnerId) {
      query = query.eq("partner_id", partnerId);
    }

    if (discountType && VALID_DISCOUNT_TYPES.includes(discountType)) {
      query = query.eq("discount_type", discountType);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error("[loyalty/cross-actions] GET error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при получении списка акций" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: (data || []) as Partial<LoyaltyCrossAction>[],
      meta: {
        limit,
        offset,
        count: data?.length ?? 0,
      },
    });
  } catch (error: any) {
    console.error("[loyalty/cross-actions] GET unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/loyalty/cross-actions — создать кросс-акцию.
 * Только LOYALTY_PARTNER, и только для своей компании.
 *
 * Тело запроса:
 *  {
 *    "partner_id": "uuid",
 *    "title": "10% скидка от ОООБанка",
 *    "description": "При оплате картой ОООБанка на маркетплейсе...",
 *    "discount_type": "percent",
 *    "discount_value": 10,
 *    "start_at": "2026-09-01T00:00:00Z",
 *    "end_at":   "2026-10-01T00:00:00Z",
 *    "usage_limit": 1000
 *  }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Проверка роли — только LOYALTY_PARTNER может создавать акции
    const guard = await requireRole(user.id, "LOYALTY_PARTNER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json();

    // Валидация обязательных полей
    const required = ["partner_id", "title", "description", "discount_type", "discount_value", "start_at", "end_at"];
    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        return NextResponse.json(
          { error: `Поле «${field}» обязательно`, field },
          { status: 422 }
        );
      }
    }

    // Валидация discount_type
    if (!VALID_DISCOUNT_TYPES.includes(body.discount_type)) {
      return NextResponse.json(
        {
          error: `discount_type должен быть одним из: ${VALID_DISCOUNT_TYPES.join(", ")}`,
        },
        { status: 422 }
      );
    }

    // Валидация дат
    const startAt = new Date(body.start_at);
    const endAt = new Date(body.end_at);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      return NextResponse.json(
        { error: "start_at и end_at должны быть валидными ISO-датами" },
        { status: 422 }
      );
    }
    if (endAt <= startAt) {
      return NextResponse.json(
        { error: "end_at должен быть позже start_at" },
        { status: 422 }
      );
    }

    // Проверить, что partner_id принадлежит пользователю
    const { data: partner, error: partnerErr } = await supabaseAdmin
      .from("loyalty_partners")
      .select("id, is_active, is_verified, company_name")
      .eq("id", body.partner_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (partnerErr || !partner) {
      return NextResponse.json(
        { error: "Партнёр не найден или не принадлежит вам" },
        { status: 404 }
      );
    }

    if (!partner.is_active || !partner.is_verified) {
      return NextResponse.json(
        { error: "Ваш партнёрский профиль ещё не верифицирован. Обратитесь к администратору." },
        { status: 422 }
      );
    }

    // Валидация discount_value
    if (typeof body.discount_value !== "number" || body.discount_value < 0) {
      return NextResponse.json(
        { error: "discount_value должен быть неотрицательным числом" },
        { status: 422 }
      );
    }
    if (body.discount_type === "percent" && body.discount_value > 100) {
      return NextResponse.json(
        { error: "discount_value для типа 'percent' не может быть больше 100" },
        { status: 422 }
      );
    }

    // Валидация usage_limit
    if (body.usage_limit !== undefined && body.usage_limit !== null) {
      if (typeof body.usage_limit !== "number" || body.usage_limit < 1) {
        return NextResponse.json(
          { error: "usage_limit должен быть положительным числом или null" },
          { status: 422 }
        );
      }
    }

    const insertData = {
      partner_id: body.partner_id,
      title: body.title,
      description: body.description,
      discount_type: body.discount_type,
      discount_value: body.discount_value,
      start_at: body.start_at,
      end_at: body.end_at,
      usage_limit: body.usage_limit ?? null,
      usage_count: 0,
      is_active: true,
    };

    const { data: created, error } = await supabaseAdmin
      .from("loyalty_cross_actions")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("[loyalty/cross-actions] POST error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при создании акции", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        data: created as LoyaltyCrossAction,
        message: "Кросс-акция создана",
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[loyalty/cross-actions] POST unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
