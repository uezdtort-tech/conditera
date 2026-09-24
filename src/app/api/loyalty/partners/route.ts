/**
 * /api/loyalty/partners/route.ts — CRUD для реестра внешних партнёров лояльности.
 *
 * GET  /api/loyalty/partners  — список активных проверенных партнёров (public)
 * POST /api/loyalty/partners  — зарегистрироваться как партнёр (только LOYALTY_PARTNER)
 *
 * Query параметры для GET:
 *  - company_type — bank | insurance | coffee_chain | restaurant_chain | retail | other
 *  - is_verified  — true/false (по умолчанию true для public endpoint)
 *  - limit        — по умолчанию 20, макс 100
 *  - offset       — по умолчанию 0
 *
 * Права:
 *  GET  — public (только активные + проверенные)
 *  POST — LOYALTY_PARTNER only
 *
 * Соответствует таблицам:
 *  - loyalty_partners (миграция 0012)
 *  - user_roles (миграция 0001)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import type { LoyaltyPartner } from "@/lib/supabase/types";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const VALID_COMPANY_TYPES = [
  "bank",
  "insurance",
  "coffee_chain",
  "restaurant_chain",
  "retail",
  "other",
] as const;
type CompanyType = (typeof VALID_COMPANY_TYPES)[number];

/**
 * GET /api/loyalty/partners — список активных проверенных партнёров.
 * Public endpoint — используется в каталоге кросс-акций для покупателей.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const companyType = searchParams.get("company_type") as CompanyType | null;
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabaseAdmin
      .from("loyalty_partners")
      .select(
        `
        id, company_name, company_type, contact_email, contact_phone,
        partnership_started_at, is_verified, is_active
      `
      )
      .eq("is_active", true)
      .eq("is_verified", true)
      .order("partnership_started_at", { ascending: false });

    if (companyType && VALID_COMPANY_TYPES.includes(companyType)) {
      query = query.eq("company_type", companyType);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error("[loyalty/partners] GET error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при получении списка партнёров" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: (data || []) as Partial<LoyaltyPartner>[],
      meta: {
        limit,
        offset,
        count: data?.length ?? 0,
      },
    });
  } catch (error: any) {
    console.error("[loyalty/partners] GET unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/loyalty/partners — регистрация как партнёр лояльности.
 * Только LOYALTY_PARTNER может создать запись.
 *
 * Тело запроса:
 *  {
 *    "company_name": "ООБанк",
 *    "company_type": "bank",
 *    "inn": "7700000000",
 *    "legal_address": "г. Москва, ул. ...",
 *    "contact_email": "partners@oo-bank.ru",
 *    "contact_phone": "+7 (495) 000-00-00"
 *  }
 *
 * После создания is_verified=false — ADMIN проверяет и устанавливает is_verified=true.
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

    // Проверка роли — только LOYALTY_PARTNER может регистрироваться
    const guard = await requireRole(user.id, "LOYALTY_PARTNER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    // Проверить, что у пользователя ещё нет партнёрской записи
    const { data: existing } = await supabaseAdmin
      .from("loyalty_partners")
      .select("id, is_verified")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          error: "У вас уже есть партнёрская запись",
          data: existing,
        },
        { status: 409 }
      );
    }

    const body = await request.json();

    // Валидация обязательных полей
    const required = ["company_name", "company_type", "contact_email"];
    for (const field of required) {
      if (!body[field] || typeof body[field] !== "string") {
        return NextResponse.json(
          { error: `Поле «${field}» обязательно и должно быть строкой` },
          { status: 422 }
        );
      }
    }

    // Валидация company_type
    if (!VALID_COMPANY_TYPES.includes(body.company_type)) {
      return NextResponse.json(
        {
          error: `company_type должен быть одним из: ${VALID_COMPANY_TYPES.join(", ")}`,
        },
        { status: 422 }
      );
    }

    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.contact_email)) {
      return NextResponse.json(
        { error: "contact_email должен быть валидным email" },
        { status: 422 }
      );
    }

    // Валидация ИНН (12 цифр для юрлиц / ИП)
    if (body.inn && !/^\d{10}$|^\d{12}$/.test(body.inn)) {
      return NextResponse.json(
        { error: "inn должен быть 10 или 12 цифр" },
        { status: 422 }
      );
    }

    // Создать партнёра
    const insertData = {
      user_id: user.id,
      company_name: body.company_name,
      company_type: body.company_type,
      inn: body.inn ?? null,
      legal_address: body.legal_address ?? null,
      contact_email: body.contact_email,
      contact_phone: body.contact_phone ?? null,
      api_key_hash: null,  // генерируется через отдельный endpoint /api/loyalty/partners/me/api-key
      api_key_scopes: [],
      is_verified: false,  // требуется ручная верификация ADMIN
      is_active: true,
    };

    const { data: created, error } = await supabaseAdmin
      .from("loyalty_partners")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("[loyalty/partners] POST error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при создании партнёра", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        data: created as LoyaltyPartner,
        message: "Заявка на партнёрство отправлена. Ожидайте верификации администратором.",
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[loyalty/partners] POST unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
