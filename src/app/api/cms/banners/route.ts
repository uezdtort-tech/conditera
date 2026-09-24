/**
 * GET /api/cms/banners — список баннеров (public)
 * POST /api/cms/banners — создать баннер (ADMIN)
 *
 * Auth: GET public, POST ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const position = searchParams.get("position");

    let query = supabaseAdmin.from("cms_banners").select("*").eq("is_active", true).order("sort_order", { ascending: true });
    if (position) query = query.eq("position", position);

    const { data, error } = await query;
    if (error) console.warn("[cms/banners] GET error:", error.message);
    return NextResponse.json({ banners: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN", "COPYWRITER"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json();
    const { data, error } = await supabaseAdmin
      .from("cms_banners")
      .insert({
        title: body.title || "Untitled",
        image_url: body.imageUrl || null,
        link_url: body.linkUrl || null,
        position: body.position || "hero",
        sort_order: body.sortOrder || 0,
        is_active: body.isActive !== false,
        start_at: body.startAt || null,
        end_at: body.endAt || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    return NextResponse.json({ banner: data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
