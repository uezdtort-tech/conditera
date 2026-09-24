/**
 * GET /api/cms/settings — все настройки (public для category, ADMIN для PUT)
 * PUT /api/cms/settings — обновить настройку (ADMIN/SUPER_ADMIN)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");

    let query = supabaseAdmin.from("site_settings").select("*").order("category", { ascending: true });
    if (category) query = query.eq("category", category);

    const { data: settings, error } = await query;
    if (error) console.warn("[cms/settings] GET error:", error.message);

    return NextResponse.json({ settings: settings || [] });
  } catch (error: any) {
    return NextResponse.json({ error: "Server error", detail: error?.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { key, value } = await request.json();

    const { data: setting, error } = await supabaseAdmin
      .from("site_settings")
      .update({ value, updated_at: new Date().toISOString() })
      .eq("key", key)
      .select()
      .single();

    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    return NextResponse.json({ setting });
  } catch (error: any) {
    return NextResponse.json({ error: "Server error", detail: error?.message }, { status: 500 });
  }
}
