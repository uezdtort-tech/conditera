import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";
const ROLES = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"] as const;
const LOCATIONS = new Set(["header", "footer", "mobile"]);
const isSafeNavUrl = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 2048 &&
  ((value.startsWith("/") && !value.startsWith("//")) || /^[a-z][a-z0-9-]*$/i.test(value));

async function authorize(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) return { user: null, response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  const guard = await requireAnyRole(user.id, [...ROLES]);
  if (guard) return { user, response: new NextResponse(guard.body, { status: guard.status, headers: guard.headers }) };
  return { user, response: null };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.label !== undefined) {
      if (typeof body.label !== "string" || !body.label.trim() || body.label.length > 100) return NextResponse.json({ error: "Некорректная подпись" }, { status: 400 });
      updates.label = body.label.trim();
    }
    if (body.url !== undefined) {
      if (!isSafeNavUrl(body.url) || !body.url.trim()) return NextResponse.json({ error: "Некорректная ссылка" }, { status: 400 });
      updates.url = body.url.trim();
    }
    if (body.location !== undefined) {
      if (!LOCATIONS.has(body.location)) return NextResponse.json({ error: "Некорректное расположение" }, { status: 400 });
      updates.location = body.location;
    }
    if (body.sortOrder !== undefined) {
      if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0 || body.sortOrder > 10000) return NextResponse.json({ error: "Некорректный порядок" }, { status: 400 });
      updates.sort_order = body.sortOrder;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
      updates.is_active = body.isActive;
    }
    if (body.icon !== undefined) updates.icon = typeof body.icon === "string" ? body.icon.slice(0, 80) : null;
    const { data, error } = await supabaseAdmin.from("cms_nav_menu").update(updates).eq("id", id).select("*").maybeSingle();
    if (error) return NextResponse.json({ error: "Не удалось обновить пункт меню" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Пункт меню не найден" }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const { id } = await params;
    const { error, count } = await supabaseAdmin.from("cms_nav_menu").delete({ count: "exact" }).eq("id", id);
    if (error) return NextResponse.json({ error: "Не удалось удалить пункт меню" }, { status: 500 });
    if (!count) return NextResponse.json({ error: "Пункт меню не найден" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
