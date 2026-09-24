/**
 * PATCH  /api/moderation/rules/[id] — обновить правило модерации
 * DELETE /api/moderation/rules/[id] — удалить правило
 *
 * Auth: только ADMIN
 *
 * Соответствует таблице: moderation_rules
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface PatchRequestBody {
  name?: string;
  description?: string;
  pattern?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  violation?: string;
  action?: "reject" | "flag" | "warn";
  isActive?: boolean;
}

/**
 * PATCH /api/moderation/rules/:id — обновить правило.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — только ADMIN
    const guard = await requireRole(user.id, "ADMIN");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = (await request.json()) as PatchRequestBody;

    // Проверить существование правила
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("moderation_rules")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { error: "Правило не найдено" },
        { status: 404 }
      );
    }

    // Собрать разрешённые поля в snake_case
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.pattern !== undefined) updateData.pattern = body.pattern;
    if (body.caseSensitive !== undefined) updateData.case_sensitive = body.caseSensitive;
    if (body.wholeWord !== undefined) updateData.whole_word = body.wholeWord;
    if (body.violation !== undefined) updateData.violation = body.violation;
    if (body.action !== undefined) updateData.action = body.action;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "Нет полей для обновления" },
        { status: 422 }
      );
    }

    updateData.updated_at = new Date().toISOString();

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("moderation_rules")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      console.error("[moderation/rules/:id] PATCH error:", updateErr.message);
      return NextResponse.json(
        { error: "Database update failed", details: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ rule: updated });
  } catch (error: any) {
    console.error("PATCH /api/moderation/rules/[id] error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/moderation/rules/:id — удалить правило.
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — только ADMIN
    const guard = await requireRole(user.id, "ADMIN");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const { error, count } = await supabaseAdmin
      .from("moderation_rules")
      .delete({ count: "exact" })
      .eq("id", id);

    if (error) {
      console.error("[moderation/rules/:id] DELETE error:", error.message);
      return NextResponse.json(
        { error: "Database delete failed", details: error.message },
        { status: 500 }
      );
    }

    if (count === 0) {
      return NextResponse.json(
        { error: "Правило не найдено" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, deletedCount: count });
  } catch (error: any) {
    console.error("DELETE /api/moderation/rules/[id] error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
