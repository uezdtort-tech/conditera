import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";
const ROLES = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"];
const SECTIONS = new Set(["hero", "stats", "cta_confectioner", "advantages", "steps", "testimonials"]);

async function authorize(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) return { user: null, response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  const guard = await requireAnyRole(user.id, ROLES);
  if (guard) return { user, response: new NextResponse(guard.body, { status: guard.status, headers: guard.headers }) };
  return { user, response: null };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const { data, error } = await supabaseAdmin.from("cms_home_blocks").select("*").order("section").order("sort_order").order("created_at");
    if (error) return NextResponse.json({ error: "Не удалось загрузить блоки CMS" }, { status: 500 });
    return NextResponse.json({ blocks: data || [] });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;
    const body = await request.json();
    if (!SECTIONS.has(body.section) || typeof body.title !== "string" || body.title.length > 180) {
      return NextResponse.json({ error: "Некорректные данные блока" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("cms_home_blocks").insert({
      section: body.section,
      title: body.title,
      subtitle: typeof body.subtitle === "string" ? body.subtitle.slice(0, 500) : "",
      content: typeof body.content === "string" ? body.content.slice(0, 20000) : "",
      image_url: typeof body.image === "string" && body.image ? body.image.slice(0, 2048) : null,
      link_url: typeof body.link === "string" && body.link ? body.link.slice(0, 2048) : null,
      link_text: typeof body.linkText === "string" ? body.linkText.slice(0, 100) : "",
      sort_order: Number.isInteger(body.sortOrder) ? Math.max(0, Math.min(body.sortOrder, 10000)) : 0,
      is_active: body.isActive !== false,
      metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {},
      created_by: auth.user!.id,
      updated_by: auth.user!.id,
    }).select("*").single();
    if (error) return NextResponse.json({ error: "Не удалось создать блок" }, { status: 500 });
    return NextResponse.json({ block: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
