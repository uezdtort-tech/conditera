/**
 * GET /api/confectioner/status — текущий статус модерации кондитера.
 *
 * Возвращает:
 *  - status: pending | approved | rejected | needs_revision
 *  - rejectionReason (если есть)
 *  - verifiedAt (если approved)
 *  - canPublish: boolean (true если approved)
 *
 * Auth: CONFECTIONER (или любой пользователь с профилем кондитера)
 *
 * Соответствует таблице: confectioners
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/confectioner/status — получить статус модерации кондитера.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    const { data: conf, error } = await supabaseAdmin
      .from("confectioners")
      .select(
        `
        verificationStatus, rejectionReason, verifiedAt, verified,
        businessName, avatar
      `
      )
      .eq("userId", user.id)
      .maybeSingle();

    if (error) {
      console.error("[confectioner/status] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    if (!conf) {
      return NextResponse.json(
        { error: "Профиль кондитера не найден" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: conf.verificationStatus,
      // Каноничное имя поля (v3 ТЗ): verificationStatus = "pending" | "approved" | "rejected"
      verificationStatus: conf.verificationStatus,
      rejectionReason: conf.rejectionReason,
      verifiedAt: conf.verifiedAt,
      canPublish: Boolean(conf.verified) || conf.verificationStatus === "approved",
      businessName: conf.businessName,
      avatar: conf.avatar,
    });
  } catch (error: any) {
    console.error("GET /api/confectioner/status error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
