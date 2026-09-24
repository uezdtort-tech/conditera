/**
 * GET /api/map/confectioners — поиск кондитеров по геолокации (Модуль 5).
 *
 * Query params: lat, lng, radiusKm, city
 * Возвращает: confectioner_geo[] с проффилем кондитера
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const lat = parseFloat(searchParams.get("lat") || "");
    const lng = parseFloat(searchParams.get("lng") || "");
    const radiusKm = parseInt(searchParams.get("radiusKm") || "20");
    const city = searchParams.get("city");

    let query = supabaseAdmin
      .from("confectioner_geo")
      .select(`
        *,
        confectioner:auth.users!confectioner_geo_confectioner_id_fkey(id)
      `)
      .eq("is_active", true)
      .not("lat", "is", null)
      .not("lng", "is", null);

    if (city) query = query.eq("city", city);

    const { data, error } = await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let results = data || [];
    if (!isNaN(lat) && !isNaN(lng)) {
      results = results.filter((c: any) => {
        const distance = Math.sqrt(Math.pow(c.lat - lat, 2) + Math.pow(c.lng - lng, 2)) * 111;
        return distance <= radiusKm;
      });
    }

    return NextResponse.json({ confectioners: results, total: results.length });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
