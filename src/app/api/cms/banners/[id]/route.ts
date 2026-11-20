import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { areValidCmsNavigationRoles, isValidCmsSchedule, isSafeCmsUrl } from "@/lib/cms-validation";

export const runtime = "nodejs";
const ROLES = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"] as const;
const POSITIONS = new Set(["home_hero", "catalog_top", "sidebar", "footer", "mobile"]);

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
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 180) return NextResponse.json({ error: "Некорректный заголовок" }, { status: 400 });
      updates.title = body.title.trim();
    }
    if (body.position !== undefined) {
      if (!POSITIONS.has(body.position)) return NextResponse.json({ error: "Некорректная позиция" }, { status: 400 });
      updates.position = body.position;
    }
    if (body.imageUrl !== undefined) {
      if (body.imageUrl && !isSafeCmsUrl(body.imageUrl)) return NextResponse.json({ error: "Некорректный URL изображения" }, { status: 400 });
      updates.image_url = typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl.slice(0, 2048) : null;
    }
    if (body.linkUrl !== undefined) {
      if (body.linkUrl && !isSafeCmsUrl(body.linkUrl)) return NextResponse.json({ error: "Некорректная ссылка" }, { status: 400 });
      updates.link_url = typeof body.linkUrl === "string" && body.linkUrl ? body.linkUrl.slice(0, 2048) : null;
    }
    if (body.text !== undefined) updates.text = typeof body.text === "string" ? body.text.slice(0, 1000) : null;
    if (body.ctaText !== undefined) updates.cta_text = typeof body.ctaText === "string" ? body.ctaText.slice(0, 100) : null;
    if (body.sortOrder !== undefined) {
      if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0 || body.sortOrder > 10000) return NextResponse.json({ error: "Некорректный порядок" }, { status: 400 });
      updates.sort_order = body.sortOrder;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
      updates.is_active = body.isActive;
    }
    if (body.targetAudience !== undefined) {
      if (body.targetAudience !== null && !areValidCmsNavigationRoles(body.targetAudience)) return NextResponse.json({ error: "Некорректная аудитория" }, { status: 400 });
      updates.target_audience = body.targetAudience;
    }
    if (body.startsAt !== undefined || body.endsAt !== undefined) {
      const { data: current, error: lookupError } = await supabaseAdmin
        .from("cms_banners").select("starts_at,ends_at").eq("id", id).maybeSingle();
      if (lookupError) return NextResponse.json({ error: "Не удалось проверить расписание баннера" }, { status: 500 });
      if (!current) return NextResponse.json({ error: "Баннер не найден" }, { status: 404 });
      const start = body.startsAt !== undefined ? body.startsAt : current.starts_at;
      const end = body.endsAt !== undefined ? body.endsAt : current.ends_at;
      if (!isValidCmsSchedule(start, end)) return NextResponse.json({ error: "Некорректный период показа баннера" }, { status: 400 });
      if (body.startsAt !== undefined) updates.starts_at = body.startsAt || null;
      if (body.endsAt !== undefined) updates.ends_at = body.endsAt || null;
    }
    const { data, error } = await supabaseAdmin.from("cms_banners").update(updates).eq("id", id).select("*").maybeSingle();
    if (error) return NextResponse.json({ error: "Не удалось обновить баннер" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Баннер не найден" }, { status: 404 });
    return NextResponse.json({ banner: data });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const { id } = await params;
    const { error, count } = await supabaseAdmin.from("cms_banners").delete({ count: "exact" }).eq("id", id);
    if (error) return NextResponse.json({ error: "Не удалось удалить баннер" }, { status: 500 });
    if (!count) return NextResponse.json({ error: "Баннер не найден" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
