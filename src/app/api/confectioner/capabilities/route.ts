/**
 * GET  /api/confectioner/capabilities — получить способности кондитера
 *   Query: ?confectionerId=...  — получить способности конкретного кондитера
 *   Query: ?productType=cake&filling=uuid&maxTiers=2&shape=round&... — поиск кондитеров по способностям
 * PUT  /api/confectioner/capabilities — обновить свои способности (CONFECTIONER only)
 * POST /api/confectioner/capabilities — создать способности (если ещё нет)
 *
 * Способности используются в поиске: когда пользователь собирает торт в конструкторе,
 * система находит кондитеров, которые могут изготовить изделие с выбранными параметрами.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

// =====================================================================
// GET — получить способности или найти кондитеров по способностям
// =====================================================================
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const confectionerId = searchParams.get("confectionerId");

    // Режим 1: получить способности конкретного кондитера
    if (confectionerId) {
      const { data, error } = await supabaseAdmin
        .from("confectioner_capabilities")
        .select("*")
        .eq("confectioner_id", confectionerId)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        console.warn("[capabilities] GET error:", error.message);
      }

      return NextResponse.json({ capabilities: data || null });
    }

    // Режим 2: поиск кондитеров по способностям
    // Строим фильтр на основе query-параметров конструктора
    let query = supabaseAdmin
      .from("confectioner_capabilities")
      .select(`
        *,
        confectioner:confectioners!inner(id, businessName, avatar, city, rating, reviewsCount, verified, trustLevel, tariff)
      `)
      .eq("is_active", true);

    // Фильтр по типу изделия
    const productType = searchParams.get("productType");
    if (productType) {
      query = query.filter("product_types", "cs", `{${productType}}`);
    }

    // Фильтр по основе
    const base = searchParams.get("base");
    if (base) {
      query = query.filter("bases", "cs", `{${base}}`);
    }

    // Фильтр по начинке (UUID)
    const filling = searchParams.get("filling");
    if (filling) {
      query = query.filter("filling_ids", "cs", `{${filling}}`);
    }

    // Фильтр по покрытию
    const coating = searchParams.get("coating");
    if (coating) {
      query = query.filter("coatings", "cs", `{${coating}}`);
    }

    // Фильтр по форме
    const shape = searchParams.get("shape");
    if (shape) {
      query = query.filter("shapes", "cs", `{${shape}}`);
    }

    // Фильтр по количеству ярусов
    const maxTiers = searchParams.get("maxTiers");
    if (maxTiers) {
      query = query.gte("max_tiers", parseInt(maxTiers));
    }

    // Фильтр по диетическим требованиям (множественный выбор)
    const dietary = searchParams.getAll("dietary");
    if (dietary.length > 0) {
      query = query.filter("dietary", "cs", `{${dietary.join(",")}}`);
    }

    // Фильтр по городу (через join с confectioners)
    const city = searchParams.get("city");
    if (city) {
      query = query.eq("confectioner.city", city);
    }

    const { data: results, error: searchError } = await query;

    if (searchError) {
      console.warn("[capabilities] search error:", searchError.message);
    }

    return NextResponse.json({
      capabilities: results || [],
      total: (results || []).length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// =====================================================================
// PUT — обновить свои способности (CONFECTIONER)
// =====================================================================
interface CapabilitiesBody {
  product_types?: string[];
  bases?: string[];
  filling_ids?: string[];
  coatings?: string[];
  shapes?: string[];
  max_tiers?: number;
  decorations?: string[];
  dietary?: string[];
  additional_skills?: string[];
  self_pickup?: boolean;
  self_delivery?: boolean;
  courier_delivery?: boolean;
  russia_delivery?: boolean;
  min_order_amount?: number;
  min_prep_days?: number;
  max_prep_days?: number;
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    // Найти запись кондитера для текущего пользователя
    const { data: confectioner, error: confError } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("userId", user.userId)
      .maybeSingle();

    if (confError || !confectioner) {
      throw new HttpError(403, "Вы не кондитер");
    }

    const { data: body, error: parseError } = await safeJsonBody<CapabilitiesBody>(req);
    if (parseError || !body) {
      throw new HttpError(400, parseError || "Невалидный JSON");
    }

    // Проверить, существует ли уже запись
    const { data: existing } = await supabaseAdmin
      .from("confectioner_capabilities")
      .select("id")
      .eq("confectioner_id", confectioner.id)
      .maybeSingle();

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      ...body,
    };

    // Валидация max_tiers
    if (body.max_tiers !== undefined) {
      if (body.max_tiers < 1 || body.max_tiers > 4) {
        throw new HttpError(400, "max_tiers должен быть от 1 до 4");
      }
    }

    if (existing) {
      // Обновить существующую запись
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("confectioner_capabilities")
        .update(updateData)
        .eq("confectioner_id", confectioner.id)
        .select()
        .single();

      if (updateError) {
        throw new HttpError(500, "DB error", updateError.message);
      }

      return NextResponse.json({ capabilities: updated });
    } else {
      // Создать новую запись
      const { data: created, error: insertError } = await supabaseAdmin
        .from("confectioner_capabilities")
        .insert({
          confectioner_id: confectioner.id,
          ...updateData,
        })
        .select()
        .single();

      if (insertError) {
        throw new HttpError(500, "DB error", insertError.message);
      }

      return NextResponse.json({ capabilities: created }, { status: 201 });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
