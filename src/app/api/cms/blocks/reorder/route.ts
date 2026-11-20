import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import type { user_role } from "@/lib/supabase/types";

export const runtime = "nodejs";

const ROLES: user_role[] = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"];
const SECTIONS = new Set(["hero", "stats", "cta_confectioner", "advantages", "steps", "testimonials"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ROLES);
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
    }

    const { section, blockIds } = body as { section?: unknown; blockIds?: unknown };
    if (
      typeof section !== "string" ||
      !SECTIONS.has(section) ||
      !Array.isArray(blockIds) ||
      blockIds.length === 0 ||
      blockIds.length > 200 ||
      !blockIds.every((id): id is string => typeof id === "string" && UUID.test(id)) ||
      new Set(blockIds).size !== blockIds.length
    ) {
      return NextResponse.json({ error: "Некорректный список блоков" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc("cms_reorder_home_blocks", {
      p_section: section,
      p_block_ids: blockIds,
      p_actor: user.id,
    });

    if (error) {
      const conflict = error.code === "40001";
      return NextResponse.json(
        { error: conflict ? "Состав секции изменился. Обновите список и повторите." : "Не удалось сохранить порядок блоков" },
        { status: conflict ? 409 : 500 },
      );
    }

    return NextResponse.json({ ok: true, section, blockIds });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}
