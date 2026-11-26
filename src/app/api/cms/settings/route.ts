import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    const guard = user ? await requireAnyRole(user.id, [...ADMIN_ROLES]) : null;
    const isAdmin = Boolean(user && !guard);
    const category = request.nextUrl.searchParams.get("category");

    let query = supabaseAdmin.from("cms_site_settings").select("*").order("category").order("key");
    if (!isAdmin) query = query.eq("is_public", true);
    if (category) query = query.eq("category", category);

    const { data, error } = await query;
    if (error) {
      console.error("[cms/settings] GET failed:", error.message);
      return NextResponse.json({ error: "Не удалось загрузить настройки" }, { status: 500 });
    }
    return NextResponse.json({ settings: data || [] }, {
      headers: { "Cache-Control": isAdmin ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json();
    if (typeof body.key !== "string" || !/^[a-zA-Z0-9_.-]{1,120}$/.test(body.key) ||
        typeof body.value !== "string" || body.value.length > 20000) {
      return NextResponse.json({ error: "Некорректный ключ или значение настройки" }, { status: 400 });
    }

    const { data: setting, error } = await supabaseAdmin
      .from("cms_site_settings")
      .update({ value: body.value, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("key", body.key)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[cms/settings] PUT failed:", error.message);
      return NextResponse.json({ error: "Не удалось сохранить настройку" }, { status: 500 });
    }
    if (!setting) return NextResponse.json({ error: "Настройка не найдена" }, { status: 404 });
    return NextResponse.json({ setting }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
