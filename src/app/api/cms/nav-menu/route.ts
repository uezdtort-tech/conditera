import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";
const ROLES = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"] as const;
const LOCATIONS = new Set(["header", "footer", "mobile"]);

async function authorize(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) return { user: null, response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  const guard = await requireAnyRole(user.id, [...ROLES]);
  if (guard) return { user, response: new NextResponse(guard.body, { status: guard.status, headers: guard.headers }) };
  return { user, response: null };
}

export async function GET(request: NextRequest) {
  try {
    const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "true";
    if (includeInactive) {
      const auth = await authorize(request);
      if (auth.response) return auth.response;
    }
    let query = supabaseAdmin.from("cms_nav_menu").select("*").order("location").order("sort_order");
    if (!includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: "Не удалось загрузить меню" }, { status: 500 });
    return NextResponse.json({ items: data || [] }, {
      headers: { "Cache-Control": includeInactive ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const body = await request.json();
    if (typeof body.label !== "string" || !body.label.trim() || body.label.length > 100 ||
        typeof body.url !== "string" || !body.url.trim() || body.url.length > 2048 ||
        (body.location !== undefined && !LOCATIONS.has(body.location))) {
      return NextResponse.json({ error: "Некорректный пункт меню" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("cms_nav_menu").insert({
      label: body.label.trim(), url: body.url.trim(), location: body.location || "header",
      icon: typeof body.icon === "string" ? body.icon.slice(0, 80) : null,
      sort_order: Number.isInteger(body.sortOrder) ? Math.max(0, Math.min(body.sortOrder, 10000)) : 0,
      is_active: body.isActive !== false,
      show_for_roles: Array.isArray(body.showForRoles) ? body.showForRoles.filter((x: unknown) => typeof x === "string").slice(0, 20) : null,
      show_for_authenticated: typeof body.showForAuthenticated === "boolean" ? body.showForAuthenticated : null,
    }).select("*").single();
    if (error) return NextResponse.json({ error: "Не удалось создать пункт меню" }, { status: 500 });
    return NextResponse.json({ item: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
