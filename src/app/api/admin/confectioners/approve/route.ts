/**
 * POST /api/admin/confectioners/approve — подтвердить кондитера.
 * Body: { confectionerId }
 *
 * После подтверждения:
 *  - verified = true
 *  - verification_status = "approved"
 *  - verified_by = userId админа
 *  - verified_at = now
 *  - rejection_reason = null (очищаем)
 *  - отправляется уведомление кондитеру
 *  - отправляется email-уведомление кондитеру
 *
 * Auth: ADMIN или SUPER_ADMIN
 *
 * Соответствует таблицам:
 *  - confectioners (обновление статуса)
 *  - notifications (push уведомление)
 *  - через @/lib/email-confectioner: sendConfectionerVerificationEmail
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface ApproveRequestBody {
  confectionerId: string;
}

/**
 * POST /api/admin/confectioners/approve — подтвердить кондитера.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Проверка роли — ADMIN или SUPER_ADMIN
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = (await request.json()) as ApproveRequestBody;
    const { confectionerId } = body;

    if (!confectionerId || typeof confectionerId !== "string") {
      return NextResponse.json(
        { error: "Укажите confectionerId" },
        { status: 400 }
      );
    }

    // Найти кондитера
    const { data: conf, error: fetchErr } = await supabaseAdmin
      .from("confectioners")
      .select("id, userId, businessName, verificationStatus")
      .eq("id", confectionerId)
      .maybeSingle();

    if (fetchErr || !conf) {
      return NextResponse.json(
        { error: "Кондитер не найден" },
        { status: 404 }
      );
    }

    if (conf.verificationStatus === "approved") {
      return NextResponse.json(
        { error: "Кондитер уже подтверждён" },
        { status: 400 }
      );
    }

    // Обновить кондитера
    const { error: updateErr } = await supabaseAdmin
      .from("confectioners")
      .update({
        verified: true,
        verificationStatus: "approved",
        verifiedBy: user.id,
        verifiedAt: new Date().toISOString(),
        rejectionReason: null,
      })
      .eq("id", confectionerId);

    if (updateErr) {
      console.error("[admin/approve] update error:", updateErr.message);
      return NextResponse.json(
        { error: "Ошибка при обновлении", details: updateErr.message },
        { status: 500 }
      );
    }

    // Push-уведомление кондитеру (non-blocking)
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: conf.userId,
        template: "ORDER_CREATED", // переиспользуем; в проде нужен отдельный шаблон VERIFICATION_APPROVED
        vars: {
          orderNumber: conf.businessName,
          total: 0,
        },
        data: {
          type: "confectioner_approved",
          confectionerId: conf.id,
        },
      });
    } catch (e: any) {
      console.warn("[approve] Notification failed:", e?.message);
    }

    // Email-уведомление кондитеру (non-blocking)
    try {
      const { sendConfectionerVerificationEmail } = await import("@/lib/email-confectioner");
      await sendConfectionerVerificationEmail(confectionerId, "approved");
    } catch (e: any) {
      console.warn("[approve] Email failed:", e?.message);
    }

    console.info(
      `[admin] Confectioner ${conf.businessName} approved by ${user.id}`
    );

    return NextResponse.json({
      success: true,
      confectionerId,
      verifiedBy: user.id,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("POST /api/admin/confectioners/approve error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
