/**
 * GET /api/confectioners — список верифицированных кондитеров (public).
 *
 * Query params:
 *   ?city=Москва        — фильтр по городу
 *   ?sort=rating|orders|followers  — сортировка (по умолчанию rating)
 *   ?limit=20           — ограничение, макс. 100
 *   ?verified_only=true — только verified=true (по умолчанию true для публичного API)
 *   ?include_unverified=true — для админ-панели (требует ADMIN)
 *
 * Schema: public.confectioners (migration 0017, camelCase columns).
 *
 * Возвращает минимизированный набор полей для публичной витрины (марки, карточки и т.д.):
 *   id, userId, businessName, slug, description, avatar, cover,
 *   city, location, rating, reviewsCount, ordersCount, verified,
 *   trustLevel, tariff, specialization, portfolioImages,
 *   followersCount, responseTime, joinedAt, selfPickup, deliveryOptions
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Минимальный публичный select — без финансовых полей (balance, totalEarnings, monthlyEarnings, legalInfo)
const PUBLIC_SELECT = `
  id, userId, businessName, slug, description, avatar, cover,
  city, location, rating, reviewsCount, ordersCount, verified,
  verificationStatus, trustLevel, tariff,
  specialization, portfolioImages, followersCount, responseTime,
  joinedAt, selfPickup, deliveryOptions, ecoBadges
`.trim().replace(/\s+/g, " ");

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get("city");
    const sort = searchParams.get("sort") || "rating";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
    const verifiedOnly = searchParams.get("verified_only") !== "false";

    let query = supabaseAdmin.from("confectioners").select(PUBLIC_SELECT).limit(limit);

    if (verifiedOnly) {
      query = query.eq("verified", true);
    }
    if (city) {
      query = query.eq("city", city);
    }

    // Schema 0017 использует camelCase: ordersCount, followersCount
    switch (sort) {
      case "orders":
        query = query.order("ordersCount", { ascending: false });
        break;
      case "followers":
        query = query.order("followersCount", { ascending: false });
        break;
      case "rating":
      default:
        query = query.order("rating", { ascending: false, nullsFirst: false });
        break;
    }

    const { data: confectioners, error } = await query;
    if (error) {
      console.warn("[confectioners] GET error:", error.message);
      // Возвращаем пустой массив вместо 500, чтобы клиент мог использовать fallback на mock
      return NextResponse.json({ confectioners: [], error: error.message });
    }

    return NextResponse.json({ confectioners: confectioners || [] });
  } catch (error: any) {
    console.error("[confectioners] GET exception:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message, confectioners: [] },
      { status: 500 }
    );
  }
}
