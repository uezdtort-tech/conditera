/**
 * POST /api/fillings/create — кондитер добавляет свою начинку (статус PENDING).
 *
 * Body: {
 *   name: string,
 *   description: string,
 *   base_sponge?: 'milk'|'chocolate'|'classic'|'caramel',
 *   flavor_group?: 'berry'|'fruit'|'chocolate'|'caramel'|'nut'|'cream'|'mousse',
 *   dietary_tags?: string[],
 *   price_multiplier?: number,  // 1.0–1.4
 *   is_seasonal?: boolean,
 *   season_months?: number[],
 *   color_code?: string  // hex color for visual
 * }
 *
 * Auth: AUTHENTICATED (CONFECTIONER)
 * Созданная начинка получает status='PENDING' — видна только создателю и админам.
 * После одобрения админом → status='APPROVED' — видна всем в конструкторе.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface CreateFillingBody {
  name?: string;
  description?: string;
  base_sponge?: string;
  flavor_group?: string;
  dietary_tags?: string[];
  price_multiplier?: number;
  is_seasonal?: boolean;
  season_months?: number[];
  color_code?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseError } = await safeJsonBody<CreateFillingBody>(req);
    if (parseError || !body) {
      throw new HttpError(400, parseError || "Невалидный JSON");
    }

    if (!body.name || !body.description) {
      throw new HttpError(400, "Укажите название и описание начинки");
    }

    // Проверка на дубликат по имени
    const { data: existing } = await supabaseAdmin
      .from("fillings")
      .select("id, status")
      .eq("name", body.name)
      .maybeSingle();

    if (existing) {
      throw new HttpError(
        409,
        existing.status === "PENDING"
          ? "Такая начинка уже предложена и ожидает модерации"
          : "Такая начинка уже существует в каталоге"
      );
    }

    const { data: filling, error: dbError } = await supabaseAdmin
      .from("fillings")
      .insert({
        name: body.name,
        description: body.description,
        base_sponge: body.base_sponge || "classic",
        flavor_group: body.flavor_group || "cream",
        dietary_tags: body.dietary_tags || [],
        price_multiplier: body.price_multiplier || 1.0,
        is_seasonal: body.is_seasonal || false,
        season_months: body.season_months || [],
        color_code: body.color_code || "#F5DEB3",
        is_active: true,
        sort_order: 999,
        status: "PENDING",
        created_by: user.userId,
        created_by_name: user.name || "Кондитер",
        usage_count: 0,
      })
      .select()
      .single();

    if (dbError) {
      throw new HttpError(500, "DB error", dbError.message);
    }

    return NextResponse.json(
      {
        filling,
        message: "Начинка отправлена на модерацию. Станет доступна после одобрения администратором.",
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
