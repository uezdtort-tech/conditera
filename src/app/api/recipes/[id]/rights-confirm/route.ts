/**
 * POST /api/recipes/[id]/rights-confirm — подтверждение прав на контент
 * рецепта (RECIPE-02, RB.14 «/api/recipes/[id]/rights-confirm», RA.13).
 *
 * Роли: автор или ADMIN (ownership серверно).
 *
 * Тело: {note?: string} — произвольная фиксация основания прав.
 *
 * Одноразовость: UPDATE выполняется ТОЛЬКО по строкам с
 * rights_confirmed=false — первое подтверждение фиксируется навсегда,
 * повторный POST не перезаписывает первую фиксацию (note и флаг) → 200.
 *
 * Publish-гейт (RA.13): импорт без подтверждённых прав не публикуется —
 * этот маршрут единственный способ поставить rights_confirmed=true
 * (клиентский флаг из POST/PATCH-тела игнорируется сервером).
 *
 * NOTE (отклонение от формулировки RB.14 «фиксирует by/at»): в схеме 0066
 * у recipe_sources нет колонок confirmed_by/confirmed_at — фиксация «кто/когда»
 * выполняется через rights_note (при пустом note сервер записывает
 * user-id + ISO-дату подтверждения). Миграции создавать запрещено (ТЗ).
 *
 * Ответ: 200 {data: {confirmed: n}, message} | 404 (нет источников).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import { safeJsonBody } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const rightsSchema = z.object({
  note: z.string().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Необходима аутентификация" }, { status: 401 });
    }

    const { data: root, error: fetchErr } = await supabaseAdmin
      .from("recipes")
      .select("id, author_id, status")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !root) {
      return NextResponse.json({ error: "Рецепт не найден" }, { status: 404 });
    }

    // Ownership: автор или ADMIN
    const isAuthor = root.author_id === user.userId;
    const admin = await isAdmin(user.userId);
    if (!isAuthor && !admin) {
      return NextResponse.json(
        { error: "Только автор или администратор может подтверждать права" },
        { status: 403 }
      );
    }

    const { data: body, error: parseErr } = await safeJsonBody(request);
    if (parseErr) {
      return NextResponse.json({ error: parseErr }, { status: 400 });
    }
    const parsed = rightsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: "Невалидное поле note" }, { status: 422 });
    }

    const { data: sources, error: srcErr } = await supabaseAdmin
      .from("recipe_sources")
      .select("id")
      .eq("recipe_id", String(root.id));

    if (srcErr) {
      console.error("[recipes/rights-confirm] sources lookup failed:", srcErr.message);
      return NextResponse.json({ error: "Ошибка при проверке источников" }, { status: 500 });
    }
    if (!sources || sources.length === 0) {
      return NextResponse.json(
        { error: "У рецепта нет записей об источниках — подтверждать права не требуется" },
        { status: 404 }
      );
    }

    // Одноразовость: только строки с rights_confirmed=false; первая фиксация
    // (флаг + note) не перезаписывается повторным POST
    const note =
      parsed.data.note?.trim() ||
      `Права подтверждены пользователем ${user.userId} (${new Date().toISOString()})`;

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("recipe_sources")
      .update({ rights_confirmed: true, rights_note: note })
      .eq("recipe_id", String(root.id))
      .eq("rights_confirmed", false)
      .select("id");

    if (updErr) {
      console.error("[recipes/rights-confirm] update failed:", updErr.message);
      return NextResponse.json({ error: "Ошибка при подтверждении прав" }, { status: 500 });
    }

    const confirmed = updated?.length ?? 0;

    return NextResponse.json({
      data: {
        recipeId: String(root.id),
        confirmed: confirmed,
        totalSources: sources.length,
        alreadyConfirmed: sources.length - confirmed,
      },
      message:
        confirmed > 0
          ? "Права на контент подтверждены (одноразовая фиксация)"
          : "Права уже подтверждены ранее — повтор не перезаписал первую фиксацию",
    });
  } catch (error: any) {
    console.error("[recipes/rights-confirm] unexpected:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
