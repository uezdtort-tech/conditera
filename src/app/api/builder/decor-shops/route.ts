/**
 * GET  /api/builder/decor-shops — список магазинов декора (public)
 * POST /api/builder/decor-shops — создать магазин (ADMIN)
 * PUT  /api/builder/decor-shops?id=... — обновить (ADMIN)
 * DELETE /api/builder/decor-shops?id=... — удалить (ADMIN)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError { message: string }
interface DecorShopRow {
  id: string; name: string; description: string | null; logo: string | null;
  website: string | null; city: string | null; delivery_cities: string[] | null;
  avg_price_level: string | null; rating: number | null; reviews_count: number | null;
  is_active: boolean | null; is_verified: boolean | null; categories: string[] | null;
  metadata: unknown;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams;
    const city = sp.get("city");
    const category = sp.get("category");
    const limit = Math.min(parseInt(sp.get("limit") || "50", 10), 200);

    let query = supabaseAdmin
      .from("builder_decor_shops")
      .select("*")
      .eq("is_active", true)
      .order("rating", { ascending: false })
      .limit(limit);

    if (city) query = query.eq("city", city);
    if (category) query = query.contains("categories", [category]);

    const { data, error } = await query as { data: DecorShopRow[] | null; error: SupabaseError | null };

    if (error) {
      console.error("[builder/decor-shops] GET error:", error.message);
      throw new HttpError(500, "Не удалось загрузить магазины");
    }

    return NextResponse.json({ shops: data || [], total: (data || []).length });
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
      name?: string; description?: string; logo?: string; website?: string;
      city?: string; delivery_cities?: string[]; avg_price_level?: string;
      categories?: string[]; metadata?: Record<string, unknown>;
    }>(request);

    if (parseErr) throw new HttpError(400, parseErr);
    if (!body || !body.name) throw new HttpError(400, "name обязателен");

    const { data, error } = await supabaseAdmin
      .from("builder_decor_shops")
      .insert({
        name: body.name,
        description: body.description || null,
        logo: body.logo || null,
        website: body.website || null,
        city: body.city || null,
        delivery_cities: body.delivery_cities || [],
        avg_price_level: body.avg_price_level || "medium",
        categories: body.categories || [],
        metadata: body.metadata || {},
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select("*")
      .single() as { data: DecorShopRow | null; error: SupabaseError | null };

    if (error) {
      console.error("[builder/decor-shops] POST error:", error.message);
      throw new HttpError(500, "Не удалось создать магазин");
    }

    return NextResponse.json({ shop: data }, { status: 201 });
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
    if (typeof body.name === "string") updateData.name = body.name;
    if (typeof body.description === "string") updateData.description = body.description;
    if (typeof body.logo === "string") updateData.logo = body.logo;
    if (typeof body.website === "string") updateData.website = body.website;
    if (typeof body.city === "string") updateData.city = body.city;
    if (Array.isArray(body.delivery_cities)) updateData.delivery_cities = body.delivery_cities;
    if (typeof body.avg_price_level === "string") updateData.avg_price_level = body.avg_price_level;
    if (Array.isArray(body.categories)) updateData.categories = body.categories;
    if (typeof body.is_active === "boolean") updateData.is_active = body.is_active;
    if (typeof body.is_verified === "boolean") updateData.is_verified = body.is_verified;
    if (body.metadata && typeof body.metadata === "object") updateData.metadata = body.metadata;

    const { data, error } = await supabaseAdmin
      .from("builder_decor_shops")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single() as { data: DecorShopRow | null; error: SupabaseError | null };

    if (error || !data) {
      console.error("[builder/decor-shops] PUT error:", error?.message);
      throw new HttpError(500, "Не удалось обновить магазин");
    }

    return NextResponse.json({ shop: data });
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

    const { error } = await supabaseAdmin.from("builder_decor_shops").delete().eq("id", id);

    if (error) {
      console.error("[builder/decor-shops] DELETE error:", error.message);
      throw new HttpError(500, "Не удалось удалить магазин");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
