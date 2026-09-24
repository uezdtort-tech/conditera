/**
 * GET    /api/builder/config — получить конфигурацию конструктора (public)
 * POST   /api/builder/config — создать опцию (ADMIN)
 * PUT    /api/builder/config?id=... — обновить опцию (ADMIN)
 * DELETE /api/builder/config?id=... — удалить опцию (ADMIN)
 *
 * Категории: product_types, event_types, bases, fillings, coatings, decorations, dietary, shops
 *
 * Auth: GET public, POST/PUT/DELETE — ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError { message: string }

interface BuilderConfigRow {
  id: string;
  category: string;
  key: string;
  label: string;
  description: string | null;
  icon: string | null;
  price_modifier: number;
  sort_order: number;
  is_active: boolean | null;
  metadata: unknown;
}

const VALID_CATEGORIES = [
  "product_types", "event_types", "bases", "fillings",
  "coatings", "decorations", "dietary", "shops",
] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const activeOnly = searchParams.get("active") !== "false";

    let query = supabaseAdmin
      .from("builder_config")
      .select("*")
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });

    if (category) query = query.eq("category", category);
    if (activeOnly) query = query.eq("is_active", true);

    const { data, error } = await query as { data: BuilderConfigRow[] | null; error: SupabaseError | null };

    if (error) {
      console.error("[builder/config] GET error:", error.message);
      throw new HttpError(500, "Не удалось загрузить конфигурацию");
    }

    const grouped: Record<string, BuilderConfigRow[]> = {};
    for (const row of data || []) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(row);
    }

    return NextResponse.json({ config: grouped, raw: data || [] });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const guard = await requireAnyRole(user.userId, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { data: body, error: parseErr } = await safeJsonBody<{
      id?: string; category?: string; key?: string; label?: string;
      description?: string; icon?: string; price_modifier?: number;
      sort_order?: number; is_active?: boolean; metadata?: Record<string, unknown>;
    }>(request);

    if (parseErr) throw new HttpError(400, parseErr);
    if (!body) throw new HttpError(400, "Тело обязательно");

    if (!body.category || !VALID_CATEGORIES.includes(body.category as typeof VALID_CATEGORIES[number])) {
      throw new HttpError(422, `category должен быть одним из: ${VALID_CATEGORIES.join(", ")}`);
    }
    if (!body.key || typeof body.key !== "string") throw new HttpError(400, "key обязателен");
    if (!body.label || typeof body.label !== "string") throw new HttpError(400, "label обязателен");

    const id = body.id || `bc_${body.category}_${body.key}_${Date.now().toString(36)}`;

    const { data, error } = await supabaseAdmin
      .from("builder_config")
      .insert({
        id, category: body.category, key: body.key, label: body.label,
        description: body.description || null, icon: body.icon || null,
        price_modifier: body.price_modifier || 0, sort_order: body.sort_order || 0,
        is_active: body.is_active !== false, metadata: body.metadata || {},
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      .select("*")
      .single() as { data: BuilderConfigRow | null; error: SupabaseError | null };

    if (error) {
      console.error("[builder/config] POST error:", error.message);
      throw new HttpError(500, "Не удалось создать опцию");
    }

    return NextResponse.json({ config: data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const guard = await requireAnyRole(user.userId, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "id обязателен");

    const { data: body, error: parseErr } = await safeJsonBody<Record<string, unknown>>(request);
    if (parseErr) throw new HttpError(400, parseErr);
    if (!body) throw new HttpError(400, "Тело обязательно");

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.label === "string") updateData.label = body.label;
    if (typeof body.description === "string") updateData.description = body.description;
    if (typeof body.icon === "string") updateData.icon = body.icon;
    if (typeof body.price_modifier === "number") updateData.price_modifier = body.price_modifier;
    if (typeof body.sort_order === "number") updateData.sort_order = body.sort_order;
    if (typeof body.is_active === "boolean") updateData.is_active = body.is_active;
    if (body.metadata && typeof body.metadata === "object") updateData.metadata = body.metadata;

    const { data, error } = await supabaseAdmin
      .from("builder_config")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single() as { data: BuilderConfigRow | null; error: SupabaseError | null };

    if (error || !data) {
      console.error("[builder/config] PUT error:", error?.message);
      throw new HttpError(500, "Не удалось обновить опцию");
    }

    return NextResponse.json({ config: data });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const guard = await requireAnyRole(user.userId, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "id обязателен");

    const { error } = await supabaseAdmin.from("builder_config").delete().eq("id", id);

    if (error) {
      console.error("[builder/config] DELETE error:", error.message);
      throw new HttpError(500, "Не удалось удалить опцию");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
