/**
 * /api/services/:id — карточка объявления услуги.
 *
 * GET    — public (если is_active), владелец/ADMIN видит и неактивные
 * PATCH  — обновить объявление (владелец или ADMIN/SUPER_ADMIN/MODERATOR)
 * DELETE — удаление (владелец или ADMIN/SUPER_ADMIN)
 *
 * Таблица: service_products (миграция 0029).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin, hasAnyRole } from "@/lib/role-guards";
import { safeJsonBody } from "@/lib/http-helpers";

export const runtime = "nodejs";

const PRICE_TYPES = ["fixed", "per_hour", "per_event", "per_guest"] as const;
const SERVICE_FORMATS = ["venue", "travel", "both"] as const;

const MAX_PRICE = 100_000_000;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/services/:id — карточка объявления.
 */
export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { data: service, error } = await supabaseAdmin
      .from("service_products")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !service) {
      return NextResponse.json({ error: "Объявление не найдено" }, { status: 404 });
    }

    if (!service.is_active) {
      const user = await getUserFromRequest(request);
      if (!user || (user.id !== service.provider_id && !(await isAdmin(user.id)))) {
        return NextResponse.json({ error: "Объявление не найдено" }, { status: 404 });
      }
    }

    // Обогащение профилем провайдера
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url, is_verified")
      .eq("id", service.provider_id)
      .maybeSingle();

    return NextResponse.json({ service: { ...service, provider: profile ?? null } });
  } catch (error: any) {
    console.error("[services/:id] GET unexpected:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

/**
 * PATCH /api/services/:id — частичное обновление объявления.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    const { data: existing } = await supabaseAdmin
      .from("service_products")
      .select("id, provider_id")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Объявление не найдено" }, { status: 404 });
    }

    const isOwner = existing.provider_id === user.id;
    const isStaff = await hasAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "MODERATOR"]);
    if (!isOwner && !isStaff) {
      return NextResponse.json({ error: "Можно редактировать только свои объявления" }, { status: 403 });
    }

    const { data: body, error: bodyErr } = await safeJsonBody<Record<string, unknown>>(request);
    if (bodyErr || !body) {
      return NextResponse.json({ error: bodyErr || "Невалидное тело" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title || title.length > MAX_TITLE) {
        return NextResponse.json({ error: `title обязателен (макс ${MAX_TITLE})` }, { status: 422 });
      }
      updates.title = title;
    }
    if (body.description !== undefined) {
      const d = String(body.description).trim();
      if (d.length > MAX_DESCRIPTION) {
        return NextResponse.json({ error: `description макс ${MAX_DESCRIPTION} символов` }, { status: 422 });
      }
      updates.description = d || null;
    }
    if (body.category !== undefined) {
      const catErr = String(body.category).trim();
      if (!catErr) return NextResponse.json({ error: "category не может быть пустым" }, { status: 422 });
      updates.category = catErr;
    }
    if (body.price !== undefined) {
      if (typeof body.price !== "number" || body.price < 0 || body.price > MAX_PRICE) {
        return NextResponse.json({ error: "price должен быть числом в копейках" }, { status: 422 });
      }
      updates.price = Math.round(body.price);
    }
    if (body.old_price !== undefined) {
      updates.old_price = typeof body.old_price === "number" ? Math.round(body.old_price) : null;
    }
    if (body.price_type !== undefined) {
      if (!PRICE_TYPES.includes(body.price_type as (typeof PRICE_TYPES)[number])) {
        return NextResponse.json(
          { error: `price_type должен быть одним из: ${PRICE_TYPES.join(", ")}` },
          { status: 422 }
        );
      }
      updates.price_type = body.price_type;
    }
    if (body.service_format !== undefined) {
      if (!SERVICE_FORMATS.includes(body.service_format as (typeof SERVICE_FORMATS)[number])) {
        return NextResponse.json(
          { error: `service_format должен быть одним из: ${SERVICE_FORMATS.join(", ")}` },
          { status: 422 }
        );
      }
      updates.service_format = body.service_format;
    }
    if (body.duration_minutes !== undefined) {
      updates.duration_minutes =
        typeof body.duration_minutes === "number" && body.duration_minutes > 0
          ? Math.round(body.duration_minutes)
          : null;
    }
    if (body.age_min !== undefined) {
      updates.age_min = typeof body.age_min === "number" ? Math.round(body.age_min) : null;
    }
    if (body.age_max !== undefined) {
      updates.age_max = typeof body.age_max === "number" ? Math.round(body.age_max) : null;
    }
    if (body.city !== undefined) {
      updates.city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : null;
    }
    if (body.images !== undefined) {
      updates.images = Array.isArray(body.images)
        ? body.images.filter((i) => typeof i === "string").slice(0, 10)
        : [];
    }
    if (body.tags !== undefined) {
      updates.tags = Array.isArray(body.tags)
        ? body.tags.filter((i) => typeof i === "string").slice(0, 15)
        : [];
    }
    if (body.includes !== undefined) {
      updates.includes = Array.isArray(body.includes)
        ? body.includes.filter((i) => typeof i === "string").slice(0, 15)
        : [];
    }
    if (body.suitable_for !== undefined) {
      updates.suitable_for = Array.isArray(body.suitable_for)
        ? body.suitable_for.filter((i) => typeof i === "string").slice(0, 15)
        : [];
    }
    if (body.safety_note !== undefined) {
      updates.safety_note = typeof body.safety_note === "string" && body.safety_note.trim()
        ? body.safety_note.trim()
        : null;
    }
    if (body.customizable !== undefined) {
      updates.customizable = Boolean(body.customizable);
    }
    // Публикация/пауза объявления
    if (body.is_active !== undefined) {
      if (!isOwner && !isStaff) {
        return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      }
      updates.is_active = Boolean(body.is_active);
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("service_products")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (updateErr) {
      console.error("[services/:id] PATCH error:", updateErr.message);
      return NextResponse.json({ error: "Не удалось обновить объявление" }, { status: 500 });
    }

    return NextResponse.json({ service: updated });
  } catch (error: any) {
    console.error("[services/:id] PATCH unexpected:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

/**
 * DELETE /api/services/:id — удаление объявления (владелец или ADMIN/SUPER_ADMIN).
 */
export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    const { data: existing } = await supabaseAdmin
      .from("service_products")
      .select("id, provider_id")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Объявление не найдено" }, { status: 404 });
    }

    const isOwner = existing.provider_id === user.id;
    const isStaff = await hasAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (!isOwner && !isStaff) {
      return NextResponse.json({ error: "Можно удалять только свои объявления" }, { status: 403 });
    }

    const { error: deleteErr } = await supabaseAdmin
      .from("service_products")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error("[services/:id] DELETE error:", deleteErr.message);
      return NextResponse.json({ error: "Не удалось удалить объявление" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[services/:id] DELETE unexpected:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
