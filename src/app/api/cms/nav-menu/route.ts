import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { areValidCmsNavigationRoles, isSafeCmsNavigationTarget } from "@/lib/cms-validation";

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
    const location = request.nextUrl.searchParams.get("location");
    if (location && !LOCATIONS.has(location)) {
      return NextResponse.json({ error: "Некорректное расположение меню" }, { status: 400 });
    }
    if (location) query = query.eq("location", location);
    if (!includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: "Не удалось загрузить меню" }, { status: 500 });

    let visibleItems = data || [];
    if (!includeInactive) {
      const user = await getUserFromRequest(request);
      let roles: string[] = [];
      if (user) {
        const { data: roleRows } = await supabaseAdmin
          .from("user_roles").select("role").eq("user_id", user.id).eq("is_active", true);
        roles = (roleRows || []).map((row) => String(row.role));
      }
      visibleItems = visibleItems.filter((item) => {
        if (item.show_for_authenticated === true && !user) return false;
        if (item.show_for_authenticated === false && user) return false;
        if (Array.isArray(item.show_for_roles) && item.show_for_roles.length > 0 &&
            !item.show_for_roles.some((role: string) => roles.includes(role))) return false;
        return true;
      });
    }
    return NextResponse.json({ items: visibleItems }, {
      headers: { "Cache-Control": "private, no-store" },
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
        !isSafeCmsNavigationTarget(body.url) || !body.url.trim() ||
        (body.location !== undefined && !LOCATIONS.has(body.location))) {
      return NextResponse.json({ error: "Некорректный пункт меню" }, { status: 400 });
    }
    if (body.showForRoles !== undefined && body.showForRoles !== null && !areValidCmsNavigationRoles(body.showForRoles)) {
      return NextResponse.json({ error: "Некорректные роли показа" }, { status: 400 });
    }
    if (body.showForAuthenticated !== undefined && body.showForAuthenticated !== null && typeof body.showForAuthenticated !== "boolean") {
      return NextResponse.json({ error: "Некорректное условие авторизации" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("cms_nav_menu").insert({
      label: body.label.trim(), url: body.url.trim(), location: body.location || "header",
      icon: typeof body.icon === "string" ? body.icon.slice(0, 80) : null,
      sort_order: Number.isInteger(body.sortOrder) ? Math.max(0, Math.min(body.sortOrder, 10000)) : 0,
      is_active: body.isActive !== false,
      show_for_roles: body.showForRoles ?? null,
      show_for_authenticated: typeof body.showForAuthenticated === "boolean" ? body.showForAuthenticated : null,
    }).select("*").single();
    if (error) return NextResponse.json({ error: "Не удалось создать пункт меню" }, { status: 500 });
    return NextResponse.json({ item: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
