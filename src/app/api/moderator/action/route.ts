/**
 * POST /api/moderator/action — выполнить действие модерации.
 *
 * Body: { type: "review"|"product"|"blog", id, action: "approve"|"reject"|"deactivate"|"activate", reason? }
 *
 * Auth: MODERATOR, ADMIN, SUPER_ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface ActionBody {
  type: "review" | "product" | "blog" | "comment";
  id: string;
  action: "approve" | "reject" | "request_revision" | "deactivate" | "activate";
  reason?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const guard = await requireAnyRole(user.id, ["MODERATOR", "ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = (await request.json()) as ActionBody;
    const { type, id, action, reason } = body;

    if (!type || !id || !action) {
      return NextResponse.json({ error: "type, id, action обязательны" }, { status: 400 });
    }

    const tableMap: Record<string, string> = {
      review: "reviews",
      product: "products",
      blog: "blogs",
      comment: "blog_comments",
    };

    const tableName = tableMap[type];
    if (!tableName) return NextResponse.json({ error: "Неизвестный type" }, { status: 400 });

    let updateData: Record<string, unknown> = {};

    if (action === "approve") {
      updateData = { is_approved: true, moderation_status: "approved", moderation_reason: null };
    } else if (action === "reject") {
      updateData = { is_approved: false, moderation_status: "rejected", moderation_reason: reason || "Отклонено модератором" };
    } else if (action === "deactivate") {
      updateData = { is_active: false };
    } else if (action === "activate") {
      updateData = { is_active: true };
    }

    updateData.moderated_by = user.id;
    updateData.moderated_at = new Date().toISOString();

    const { error } = await supabaseAdmin.from(tableName).update(updateData).eq("id", id);

    if (error) {
      return NextResponse.json({ error: "DB error", details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, type, id, action });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
