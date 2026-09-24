/**
 * GET  /api/builder/partners — список предложений партнёров (public)
 * POST /api/builder/partners — создать предложение (AUTHENTICATED — партнёр или ADMIN)
 * PUT  /api/builder/partners?id=... — обновить (владелец или ADMIN)
 * DELETE /api/builder/partners?id=... — удалить (владелец или ADMIN)
 *
 * Partner types: confectioner, atelier, cafe, restaurant, shop
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError { message: string }
interface PartnerOfferRow {
  id: string; partner_id: string; partner_type: string; partner_name: string;
  partner_avatar: string | null; city: string | null; product_type: string | null;
  avg_price: number | null; min_price: number | null; max_price: number | null;
  rating: number | null; reviews_count: number | null; is_verified: boolean | null;
  is_active: boolean | null; specialties: string[] | null; metadata: unknown;
}

const PARTNER_TYPES = ["confectioner", "atelier", "cafe", "restaurant", "shop"] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams;
    const city = sp.get("city");
    const productType = sp.get("productType");
    const partnerType = sp.get("partnerType");
    const limit = Math.min(parseInt(sp.get("limit") || "50", 10), 200);

    let query = supabaseAdmin
      .from("builder_partner_offers")
      .select("*")
      .eq("is_active", true)
      .order("rating", { ascending: false })
      .order("avg_price", { ascending: true })
      .limit(limit);

    if (city) query = query.eq("city", city);
    if (productType) query = query.eq("product_type", productType);
    if (partnerType) query = query.eq("partner_type", partnerType);

    const { data, error } = await query as { data: PartnerOfferRow[] | null; error: SupabaseError | null };

    if (error) {
      console.error("[builder/partners] GET error:", error.message);
      throw new HttpError(500, "Не удалось загрузить предложения");
    }

    return NextResponse.json({ partners: data || [], total: (data || []).length });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseErr } = await safeJsonBody<{
      partner_type?: string; partner_name?: string; partner_avatar?: string;
      city?: string; product_type?: string; avg_price?: number; min_price?: number;
      max_price?: number; specialties?: string[]; metadata?: Record<string, unknown>;
    }>(request);

    if (parseErr) throw new HttpError(400, parseErr);
    if (!body) throw new HttpError(400, "Тело обязательно");

    const ptResult = readEnumField({ pt: body.partner_type }, "pt", PARTNER_TYPES, { required: true });
    if (ptResult.error || !ptResult.value) throw new HttpError(422, ptResult.error || "Невалидный partner_type");
    if (!body.partner_name) throw new HttpError(400, "partner_name обязателен");

    const { data, error } = await supabaseAdmin
      .from("builder_partner_offers")
      .insert({
        partner_id: user.userId,
        partner_type: ptResult.value,
        partner_name: body.partner_name,
        partner_avatar: body.partner_avatar || null,
        city: body.city || null,
        product_type: body.product_type || null,
        avg_price: body.avg_price || null,
        min_price: body.min_price || null,
        max_price: body.max_price || null,
        specialties: body.specialties || [],
        metadata: body.metadata || {},
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select("*")
      .single() as { data: PartnerOfferRow | null; error: SupabaseError | null };

    if (error) {
      console.error("[builder/partners] POST error:", error.message);
      throw new HttpError(500, "Не удалось создать предложение");
    }

    return NextResponse.json({ partner: data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "id обязателен");

    const adminCheck = await isAdmin(user.userId);

    const { data: existing } = await supabaseAdmin
      .from("builder_partner_offers")
      .select("partner_id")
      .eq("id", id)
      .maybeSingle() as { data: { partner_id: string } | null; error: SupabaseError | null };

    if (!existing) throw new HttpError(404, "Предложение не найдено");
    if (existing.partner_id !== user.userId && !adminCheck) {
      throw new HttpError(403, "Нет прав на редактирование");
    }

    const { data: body, error: parseErr } = await safeJsonBody<Record<string, unknown>>(request);
    if (parseErr) throw new HttpError(400, parseErr);
    if (!body) throw new HttpError(400, "Тело обязательно");

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.partner_name === "string") updateData.partner_name = body.partner_name;
    if (typeof body.partner_avatar === "string") updateData.partner_avatar = body.partner_avatar;
    if (typeof body.city === "string") updateData.city = body.city;
    if (typeof body.product_type === "string") updateData.product_type = body.product_type;
    if (typeof body.avg_price === "number") updateData.avg_price = body.avg_price;
    if (typeof body.min_price === "number") updateData.min_price = body.min_price;
    if (typeof body.max_price === "number") updateData.max_price = body.max_price;
    if (Array.isArray(body.specialties)) updateData.specialties = body.specialties;
    if (typeof body.is_active === "boolean") updateData.is_active = body.is_active;
    if (body.metadata && typeof body.metadata === "object") updateData.metadata = body.metadata;
    if (typeof body.is_verified === "boolean" && adminCheck) updateData.is_verified = body.is_verified;

    const { data, error } = await supabaseAdmin
      .from("builder_partner_offers")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single() as { data: PartnerOfferRow | null; error: SupabaseError | null };

    if (error || !data) {
      console.error("[builder/partners] PUT error:", error?.message);
      throw new HttpError(500, "Не удалось обновить предложение");
    }

    return NextResponse.json({ partner: data });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "id обязателен");

    const adminCheck = await isAdmin(user.userId);

    const { data: existing } = await supabaseAdmin
      .from("builder_partner_offers")
      .select("partner_id")
      .eq("id", id)
      .maybeSingle() as { data: { partner_id: string } | null; error: SupabaseError | null };

    if (!existing) throw new HttpError(404, "Предложение не найдено");
    if (existing.partner_id !== user.userId && !adminCheck) {
      throw new HttpError(403, "Нет прав на удаление");
    }

    const { error } = await supabaseAdmin.from("builder_partner_offers").delete().eq("id", id);

    if (error) {
      console.error("[builder/partners] DELETE error:", error.message);
      throw new HttpError(500, "Не удалось удалить предложение");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
