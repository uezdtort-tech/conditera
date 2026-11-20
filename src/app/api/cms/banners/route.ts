import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"] as const;
const POSITIONS = new Set(["home_hero", "catalog_top", "sidebar", "footer", "mobile"]);

async function authorize(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) return { user: null, response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
  if (guard) return { user, response: new NextResponse(guard.body, { status: guard.status, headers: guard.headers }) };
  return { user, response: null };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "true";
    const now = new Date().toISOString();
    let query = supabaseAdmin.from("cms_banners").select("*").order("sort_order", { ascending: true });
    if (!includeInactive) {
      query = query.eq("is_active", true)
        .or(`starts_at.is.null,starts_at.lte.${now}`)
        .or(`ends_at.is.null,ends_at.gte.${now}`);
    } else {
      const auth = await authorize(request);
      if (auth.response) return auth.response;
    }
    const position = request.nextUrl.searchParams.get("position");
    if (position) query = query.eq("position", position);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: "Не удалось загрузить баннеры" }, { status: 500 });
    return NextResponse.json({ banners: data || [] }, {
      headers: { "Cache-Control": includeInactive ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const body = await request.json();
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 180 ||
        (body.position !== undefined && !POSITIONS.has(body.position))) {
      return NextResponse.json({ error: "Некорректные данные баннера" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("cms_banners").insert({
      title: body.title.trim(),
      image_url: typeof body.imageUrl === "string" ? body.imageUrl.slice(0, 2048) : null,
      link_url: typeof body.linkUrl === "string" ? body.linkUrl.slice(0, 2048) : null,
      position: body.position || "home_hero",
      text: typeof body.text === "string" ? body.text.slice(0, 1000) : null,
      cta_text: typeof body.ctaText === "string" ? body.ctaText.slice(0, 100) : null,
      sort_order: Number.isInteger(body.sortOrder) ? Math.max(0, Math.min(body.sortOrder, 10000)) : 0,
      is_active: body.isActive !== false,
      starts_at: body.startsAt || null,
      ends_at: body.endsAt || null,
      target_audience: Array.isArray(body.targetAudience) ? body.targetAudience.filter((x: unknown) => typeof x === "string").slice(0, 20) : null,
    }).select("*").single();
    if (error) return NextResponse.json({ error: "Не удалось создать баннер" }, { status: 500 });
    return NextResponse.json({ banner: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
