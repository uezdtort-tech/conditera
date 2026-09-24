/**
 * GET   /api/venues/:id  — карточка площадки (public для active, иначе — владелец/ADMIN)
 * PATCH /api/venues/:id  — обновить (только владелец или ADMIN)
 * DELETE /api/venues/:id  — soft-delete (is_active=false; только владелец или ADMIN)
 *
 * Auth:
 *  GET    — public (если is_active=true) или владелец/ADMIN (для неактивных)
 *  PATCH  — владелец (owner_id == user.id) или ADMIN
 *  DELETE — владелец или ADMIN
 *
 * Соответствует таблице: venues (миграции 0008_geo + 0011_rbac_franchise_escrow)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/venues/:id — карточка площадки.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const { data: venue, error } = await supabaseAdmin
      .from("venues")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !venue) {
      return NextResponse.json(
        { error: "Площадка не найдена" },
        { status: 404 }
      );
    }

    // Если площадка неактивна — проверить права
    if (!venue.is_active) {
      const user = await getUserFromRequest(request);
      if (!user) {
        return NextResponse.json(
          { error: "Площадка не найдена или неактивна" },
          { status: 404 }
        );
      }
      const isOwner = venue.owner_id === user.id;
      const adminCheck = await isAdmin(user.id);
      if (!isOwner && !adminCheck) {
        return NextResponse.json(
          { error: "Площадка не найдена или неактивна" },
          { status: 404 }
        );
      }
    }

    return NextResponse.json({ data: venue });
  } catch (error: any) {
    console.error("[venues/:id] GET unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/venues/:id — обновить площадку.
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

    // Найти площадку
    const { data: venue, error: fetchErr } = await supabaseAdmin
      .from("venues")
      .select("id, owner_id, is_active")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !venue) {
      return NextResponse.json(
        { error: "Площадка не найдена" },
        { status: 404 }
      );
    }

    const isOwner = venue.owner_id === user.id;
    const adminCheck = await isAdmin(user.id);

    if (!isOwner && !adminCheck) {
      return NextResponse.json(
        { error: "У вас нет прав на редактирование этой площадки" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Разрешённые к обновлению поля
    const allowed: Record<string, unknown> = {};
    const allowedFields = [
      "name", "address", "capacity", "price_per_hour",
      "description", "images", "amenities", "is_active",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        allowed[field] = body[field];
      }
    }

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json(
        { error: "Нет полей для обновления" },
        { status: 422 }
      );
    }

    // Валидация capacity
    if (allowed.capacity !== undefined) {
      if (typeof allowed.capacity !== "number" || allowed.capacity < 1 || allowed.capacity > 10000) {
        return NextResponse.json(
          { error: "capacity должен быть числом от 1 до 10000" },
          { status: 422 }
        );
      }
    }

    // Валидация price_per_hour
    if (allowed.price_per_hour !== undefined) {
      if (typeof allowed.price_per_hour !== "number" || allowed.price_per_hour < 0) {
        return NextResponse.json(
          { error: "price_per_hour должен быть неотрицательным числом" },
          { status: 422 }
        );
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from("venues")
      .update(allowed)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[venues/:id] PATCH error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при обновлении", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: updated });
  } catch (error: any) {
    console.error("[venues/:id] PATCH unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/venues/:id — soft-delete (is_active=false).
 */
export async function DELETE(
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

    // Найти площадку
    const { data: venue, error: fetchErr } = await supabaseAdmin
      .from("venues")
      .select("id, owner_id, is_active")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !venue) {
      return NextResponse.json(
        { error: "Площадка не найдена" },
        { status: 404 }
      );
    }

    const isOwner = venue.owner_id === user.id;
    const adminCheck = await isAdmin(user.id);

    if (!isOwner && !adminCheck) {
      return NextResponse.json(
        { error: "У вас нет прав на удаление этой площадки" },
        { status: 403 }
      );
    }

    // Soft-delete через is_active=false
    const { error: deleteErr } = await supabaseAdmin
      .from("venues")
      .update({ is_active: false })
      .eq("id", id);

    if (deleteErr) {
      console.error("[venues/:id] DELETE error:", deleteErr.message);
      return NextResponse.json(
        { error: "Ошибка при удалении" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: { id },
      message: "Площадка снята с публикации",
    });
  } catch (error: any) {
    console.error("[venues/:id] DELETE unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
