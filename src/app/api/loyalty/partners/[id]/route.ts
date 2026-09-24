/**
 * /api/loyalty/partners/[id]/route.ts — операции с конкретным партнёром.
 *
 * GET   /api/loyalty/partners/:id — карточка партнёра (public если verified, иначе — self/admin)
 * PATCH /api/loyalty/partners/:id — обновить профиль (только владелец или ADMIN)
 *
 * Права:
 *  GET   — public (verified+active) или self или ADMIN
 *  PATCH — self (ограниченный набор полей) или ADMIN (все поля, включая is_verified)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import type { LoyaltyPartner } from "@/lib/supabase/types";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const { data: partner, error } = await supabaseAdmin
      .from("loyalty_partners")
      .select(
        `
        id, user_id, company_name, company_type, inn, legal_address,
        contact_email, contact_phone, is_verified, is_active,
        partnership_started_at, partnership_ended_at, created_at
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (error || !partner) {
      return NextResponse.json(
        { error: "Партнёр не найден" },
        { status: 404 }
      );
    }

    // Если партнёр не verified — проверить права
    if (!partner.is_verified) {
      const user = await getUserFromRequest(request);
      if (!user) {
        return NextResponse.json(
          { error: "Партнёр не найден или не верифицирован" },
          { status: 404 }
        );
      }
      const isOwner = partner.user_id === user.id;
      const adminCheck = await isAdmin(user.id);
      if (!isOwner && !adminCheck) {
        return NextResponse.json(
          { error: "Партнёр не найден или не верифицирован" },
          { status: 404 }
        );
      }
    }

    // Не возвращать публично чувствительные поля
    return NextResponse.json({
      data: {
        id: partner.id,
        company_name: partner.company_name,
        company_type: partner.company_type,
        contact_email: partner.contact_email,
        contact_phone: partner.contact_phone,
        is_verified: partner.is_verified,
        is_active: partner.is_active,
        partnership_started_at: partner.partnership_started_at,
      } as Partial<LoyaltyPartner>,
    });
  } catch (error: any) {
    console.error("[loyalty/partners/:id] GET unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/loyalty/partners/:id — обновить профиль партнёра.
 *
 * Self — может обновлять: company_name, legal_address, contact_email, contact_phone, inn
 * ADMIN — может обновлять: + is_verified, is_active, partnership_ended_at
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Найти партнёра
    const { data: partner, error: fetchErr } = await supabaseAdmin
      .from("loyalty_partners")
      .select("id, user_id, is_verified, is_active")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !partner) {
      return NextResponse.json(
        { error: "Партнёр не найден" },
        { status: 404 }
      );
    }

    const isOwner = partner.user_id === user.id;
    const adminCheck = await isAdmin(user.id);

    if (!isOwner && !adminCheck) {
      return NextResponse.json(
        { error: "У вас нет прав на редактирование этого профиля" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Self может обновлять только контактные данные
    const selfAllowedFields = [
      "company_name", "legal_address", "contact_email", "contact_phone", "inn",
    ];
    // ADMIN может обновлять все поля + статусы
    const adminOnlyFields = [
      "is_verified", "is_active", "partnership_ended_at", "api_key_hash", "api_key_scopes",
    ];

    const updateData: Record<string, unknown> = {};

    for (const field of selfAllowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (adminCheck) {
      for (const field of adminOnlyFields) {
        if (body[field] !== undefined) {
          updateData[field] = body[field];
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "Нет полей для обновления" },
        { status: 422 }
      );
    }

    // Валидация contact_email
    if (updateData.contact_email && typeof updateData.contact_email === "string") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updateData.contact_email)) {
        return NextResponse.json(
          { error: "contact_email должен быть валидным email" },
          { status: 422 }
        );
      }
    }

    // Валидация ИНН
    if (updateData.inn && typeof updateData.inn === "string") {
      if (!/^\d{10}$|^\d{12}$/.test(updateData.inn)) {
        return NextResponse.json(
          { error: "inn должен быть 10 или 12 цифр" },
          { status: 422 }
        );
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from("loyalty_partners")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[loyalty/partners/:id] PATCH error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при обновлении", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: updated as LoyaltyPartner });
  } catch (error: any) {
    console.error("[loyalty/partners/:id] PATCH unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
