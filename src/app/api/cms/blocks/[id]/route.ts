import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import type { user_role } from "@/lib/supabase/types";

export const runtime = "nodejs";
const ROLES: user_role[] = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"];
const SECTIONS = new Set(["hero", "stats", "cta_confectioner", "advantages", "steps", "testimonials"]);

async function authorize(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) return { user: null, response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  const guard = await requireAnyRole(user.id, ROLES);
  if (guard) return { user, response: new NextResponse(guard.body, { status: guard.status, headers: guard.headers }) };
  return { user, response: null };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = { updated_by: auth.user!.id, updated_at: new Date().toISOString() };
    if (body.section !== undefined) {
      if (!SECTIONS.has(body.section)) return NextResponse.json({ error: "Некорректная секция" }, { status: 400 });
      updates.section = body.section;
    }
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || body.title.length > 180) return NextResponse.json({ error: "Некорректный заголовок" }, { status: 400 });
      updates.title = body.title;
    }
    if (body.subtitle !== undefined) updates.subtitle = typeof body.subtitle === "string" ? body.subtitle.slice(0, 500) : "";
    if (body.content !== undefined) updates.content = typeof body.content === "string" ? body.content.slice(0, 20000) : "";
    if (body.image !== undefined) updates.image_url = typeof body.image === "string" && body.image ? body.image.slice(0, 2048) : null;
    if (body.link !== undefined) updates.link_url = typeof body.link === "string" && body.link ? body.link.slice(0, 2048) : null;
    if (body.linkText !== undefined) updates.link_text = typeof body.linkText === "string" ? body.linkText.slice(0, 100) : "";
    if (body.sortOrder !== undefined) {
      if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0 || body.sortOrder > 10000) return NextResponse.json({ error: "Некорректный порядок" }, { status: 400 });
      updates.sort_order = body.sortOrder;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
      updates.is_active = body.isActive;
    }
    if (body.metadata !== undefined) {
      if (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata)) return NextResponse.json({ error: "Некорректные метаданные" }, { status: 400 });
      updates.metadata = body.metadata;
    }
    const { data, error } = await supabaseAdmin.from("cms_home_blocks").update(updates).eq("id", id).select("*").maybeSingle();
    if (error) return NextResponse.json({ error: "Не удалось обновить блок" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Блок не найден" }, { status: 404 });
    return NextResponse.json({ block: data });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const { id } = await params;
    const { error, count } = await supabaseAdmin.from("cms_home_blocks").delete({ count: "exact" }).eq("id", id);
    if (error) return NextResponse.json({ error: "Не удалось удалить блок" }, { status: 500 });
    if (!count) return NextResponse.json({ error: "Блок не найден" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
