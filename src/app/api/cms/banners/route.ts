import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { areValidCmsNavigationRoles, isValidCmsSchedule, isSafeCmsUrl } from "@/lib/cms-validation";

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

    let visibleBanners = data || [];
    if (!includeInactive) {
      const user = await getUserFromRequest(request);
      let roles: string[] = [];
      if (user) {
        const { data: roleRows } = await supabaseAdmin
          .from("user_roles").select("role").eq("user_id", user.id).eq("is_active", true);
        roles = (roleRows || []).map((row) => String(row.role));
      }
      visibleBanners = visibleBanners.filter((banner) =>
        !Array.isArray(banner.target_audience) || banner.target_audience.length === 0 ||
        banner.target_audience.some((role: string) => roles.includes(role))
      );
    }
    return NextResponse.json({ banners: visibleBanners }, {
      headers: { "Cache-Control": "private, no-store" },
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
        (body.position !== undefined && !POSITIONS.has(body.position)) ||
        (body.imageUrl && !isSafeCmsUrl(body.imageUrl)) || (body.linkUrl && !isSafeCmsUrl(body.linkUrl))) {
      return NextResponse.json({ error: "Некорректные данные баннера" }, { status: 400 });
    }
    if (body.targetAudience !== undefined && body.targetAudience !== null && !areValidCmsNavigationRoles(body.targetAudience)) {
      return NextResponse.json({ error: "Некорректная целевая аудитория" }, { status: 400 });
    }
    if (!isValidCmsSchedule(body.startsAt, body.endsAt)) {
      return NextResponse.json({ error: "Некорректный период показа баннера" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("cms_banners").insert({
      title: body.title.trim(),
      image_url: typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl.slice(0, 2048) : null,
      link_url: typeof body.linkUrl === "string" ? body.linkUrl.slice(0, 2048) : null,
      position: body.position || "home_hero",
      text: typeof body.text === "string" ? body.text.slice(0, 1000) : null,
      cta_text: typeof body.ctaText === "string" ? body.ctaText.slice(0, 100) : null,
      sort_order: Number.isInteger(body.sortOrder) ? Math.max(0, Math.min(body.sortOrder, 10000)) : 0,
      is_active: body.isActive !== false,
      starts_at: body.startsAt || null,
      ends_at: body.endsAt || null,
      target_audience: body.targetAudience ?? null,
    }).select("*").single();
    if (error) return NextResponse.json({ error: "Не удалось создать баннер" }, { status: 500 });
    return NextResponse.json({ banner: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
