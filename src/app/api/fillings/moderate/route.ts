/**
 * POST /api/fillings/moderate — администратор одобряет или отклоняет начинку.
 *
 * Body: { fillingId, action: "approve" | "reject", rejectionReason?, adminNotes? }
 * Auth: ADMIN or SUPER_ADMIN
 *
 * При одобрении: status → APPROVED, approved_by, approved_at
 * При отклонении: status → REJECTED, rejected_reason
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface ModerateBody {
  fillingId?: string;
  action?: "approve" | "reject";
  rejectionReason?: string;
  adminNotes?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new HttpError(401, "Не авторизован");

    // Проверка роли ADMIN или SUPER_ADMIN
    const roles = (user.roles as string[]) || [];
    if (!roles.includes("ADMIN") && !roles.includes("SUPER_ADMIN")) {
      throw new HttpError(403, "Требуется роль ADMIN");
    }

    const { data: body, error: parseError } = await safeJsonBody<ModerateBody>(req);
    if (parseError || !body) {
      throw new HttpError(400, parseError || "Невалидный JSON");
    }

    if (!body.fillingId || !body.action) {
      throw new HttpError(400, "Укажите fillingId и action (approve или reject)");
    }

    const updateData: Record<string, unknown> = {};

    if (body.action === "approve") {
      updateData.status = "APPROVED";
      updateData.approved_by = user.userId;
      updateData.approved_at = new Date().toISOString();
      updateData.rejected_reason = null;
      updateData.admin_notes = body.adminNotes || null;
      updateData.is_active = true;
    } else if (body.action === "reject") {
      updateData.status = "REJECTED";
      updateData.rejected_reason = body.rejectionReason || "Отклонено администратором";
      updateData.admin_notes = body.adminNotes || null;
      updateData.is_active = false;
    } else {
      throw new HttpError(400, "action должен быть approve или reject");
    }

    const { data: filling, error: dbError } = await supabaseAdmin
      .from("fillings")
      .update(updateData)
      .eq("id", body.fillingId)
      .select()
      .single();

    if (dbError) {
      throw new HttpError(500, "DB error", dbError.message);
    }

    return NextResponse.json({
      filling,
      message: body.action === "approve"
        ? "Начинка одобрена и теперь доступна в конструкторе"
        : "Начинка отклонена",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
