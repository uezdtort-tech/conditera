import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import type { user_role } from "@/lib/supabase/types";

export const runtime = "nodejs";

const ROLES: user_role[] = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"];
const SECTION_KEYS = ["hero", "stats", "cta_confectioner", "advantages", "steps", "testimonials"] as const;

async function authorize(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) return { user: null, response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  const guard = await requireAnyRole(user.id, ROLES);
  if (guard) return { user, response: new NextResponse(guard.body, { status: guard.status, headers: guard.headers }) };
  return { user, response: null };
}

export async function GET(request: NextRequest) {
  try {
    const publicOnly = request.nextUrl.searchParams.get("public") === "true";
    if (!publicOnly) {
      const auth = await authorize(request);
      if (auth.response) return auth.response;
    }
    let query = supabaseAdmin.from("cms_home_sections").select("section,title,sort_order,is_enabled");
    const { data, error } = await query.order("sort_order").order("section");
    if (error) return NextResponse.json({ error: "Не удалось загрузить композицию главной" }, { status: 500 });
    return NextResponse.json({ sections: data || [] }, {
      headers: { "Cache-Control": publicOnly ? "public, s-maxage=60, stale-while-revalidate=300" : "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.response) return auth.response;

    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }
    const sections = (body as { sections?: unknown }).sections;
    if (!Array.isArray(sections) || sections.length !== SECTION_KEYS.length) {
      return NextResponse.json({ error: "Необходимо передать все шесть секций" }, { status: 400 });
    }

    const normalized = sections.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const value = item as Record<string, unknown>;
      if (
        typeof value.section !== "string" ||
        !SECTION_KEYS.includes(value.section as typeof SECTION_KEYS[number]) ||
        typeof value.title !== "string" ||
        value.title.trim().length === 0 ||
        value.title.length > 100 ||
        !Number.isInteger(value.sort_order) ||
        (value.sort_order as number) < 0 ||
        (value.sort_order as number) > 1000 ||
        typeof value.is_enabled !== "boolean"
      ) return null;
      return {
        section: value.section,
        title: value.title.trim(),
        sort_order: value.sort_order,
        is_enabled: value.is_enabled,
      };
    });

    if (normalized.some((item) => item === null) ||
        new Set(normalized.map((item) => item?.section)).size !== SECTION_KEYS.length ||
        new Set(normalized.map((item) => item?.sort_order)).size !== SECTION_KEYS.length) {
      return NextResponse.json({ error: "Секции, названия и позиции должны быть уникальными и корректными" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc("cms_update_home_sections", {
      p_sections: normalized,
      p_actor: auth.user!.id,
    });
    if (error) {
      return NextResponse.json({ error: "Не удалось сохранить композицию главной" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, sections: normalized });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
