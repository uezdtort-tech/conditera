/**
 * GET /api/promotions — список активных акций (public).
 * Query: ?city=&type=
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get("city");
    const type = searchParams.get("type");
    const nowIso = new Date().toISOString();

    let query = supabaseAdmin
      .from("promotions")
      .select("*")
      .eq("status", "active")
      .gte("end_date", nowIso)
      .order("is_promoted", { ascending: false });

    if (type) query = query.eq("type", type);

    const { data: promotions, error } = await query;
    if (error) console.warn("[promotions] GET error:", error.message);

    // Filter by city (cities is String[])
    let result = promotions || [];
    if (city) {
      result = result.filter((p: any) => {
        const cities = (p.cities as string[]) || [];
        return cities.length === 0 || cities.includes(city);
      });
    }

    return NextResponse.json({ promotions: result });
  } catch (error: any) {
    return NextResponse.json({ error: "Внутренняя ошибка", detail: error?.message }, { status: 500 });
  }
}
