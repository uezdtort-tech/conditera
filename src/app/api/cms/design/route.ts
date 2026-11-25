import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[a-zA-Z0-9 _-]{1,80}$/;

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("design_settings")
      .select("id,theme,primary_color,accent_color,background_color,text_color,font_heading,font_body,layout_style,max_width,animations_enabled,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Не удалось загрузить настройки дизайна" }, { status: 500 });
    return NextResponse.json({ design: data }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireAnyRole(user.id, [...ADMIN_ROLES]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = await request.json();
    const updates: Record<string, unknown> = { updated_by: user.id, updated_at: new Date().toISOString() };
    if (body.theme !== undefined) {
      if (!["default", "dark", "custom"].includes(body.theme)) return NextResponse.json({ error: "Некорректная тема" }, { status: 400 });
      updates.theme = body.theme;
    }
    for (const [field, column] of [
      ["primaryColor", "primary_color"], ["accentColor", "accent_color"],
      ["backgroundColor", "background_color"], ["textColor", "text_color"],
    ] as const) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== "string" || !COLOR.test(body[field])) return NextResponse.json({ error: "Цвет должен быть в формате #RRGGBB" }, { status: 400 });
        updates[column] = body[field];
      }
    }
    for (const [field, column] of [["fontHeading", "font_heading"], ["fontBody", "font_body"]] as const) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== "string" || !FONT.test(body[field])) return NextResponse.json({ error: "Некорректное название шрифта" }, { status: 400 });
        updates[column] = body[field];
      }
    }
    if (body.layoutStyle !== undefined) {
      if (!["classic", "modern", "minimal"].includes(body.layoutStyle)) return NextResponse.json({ error: "Некорректный стиль макета" }, { status: 400 });
      updates.layout_style = body.layoutStyle;
    }
    if (body.maxWidth !== undefined) {
      if (!Number.isInteger(body.maxWidth) || body.maxWidth < 960 || body.maxWidth > 1600) return NextResponse.json({ error: "Ширина должна быть от 960 до 1600 px" }, { status: 400 });
      updates.max_width = body.maxWidth;
    }
    if (body.animationsEnabled !== undefined) {
      if (typeof body.animationsEnabled !== "boolean") return NextResponse.json({ error: "Некорректное значение анимаций" }, { status: 400 });
      updates.animations_enabled = body.animationsEnabled;
    }

    const { data: current, error: readError } = await supabaseAdmin
      .from("design_settings").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (readError) return NextResponse.json({ error: "Не удалось прочитать текущие настройки" }, { status: 500 });
    const query = current
      ? supabaseAdmin.from("design_settings").update(updates).eq("id", current.id)
      : supabaseAdmin.from("design_settings").insert(updates);
    const { data, error } = await query
      .select("id,theme,primary_color,accent_color,background_color,text_color,font_heading,font_body,layout_style,max_width,animations_enabled,updated_at")
      .single();
    if (error) return NextResponse.json({ error: "Не удалось сохранить настройки дизайна" }, { status: 500 });
    return NextResponse.json({ design: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
