/**
 * GET /api/pricing/regional — статистика цен для регионального ценообразования.
 *
 * Отдаёт медианную цену за 1 кг по каталогу (и количество валидных образцов).
 * Используется клиентом конструктора тортов (regional-pricing.ts) вместо
 * прямого доступа к БД — чтобы admin-клиент не попадал в клиентский бандл.
 *
 * Безопасность:
 *   • Public endpoint: только агрегат (median/count) по опубликованным ценам,
 *     никаких приватных данных.
 *   • limit/offset не предоставляются — фиксированная выборка каталога.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeMedianPricePerKg, type PriceSampleRow } from "@/lib/pricing-stats";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

const MAX_SAMPLE_ROWS = 200;

interface SupabaseError {
  message: string;
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    // ВАЖНО: у products нет колонки city (город живёт в confectioners),
    // выборка общекаталожная — сигнатура city зарезервирована под будущий enrichment.
    const { data: products, error } = await supabaseAdmin
      .from("products")
      .select("price, weight_grams, servings")
      .order("price", { ascending: true })
      .limit(MAX_SAMPLE_ROWS) as { data: PriceSampleRow[] | null; error: SupabaseError | null };

    if (error) throw error;

    const stats = computeMedianPricePerKg(products || []);

    return NextResponse.json(
      { median: stats.median, count: stats.count },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
