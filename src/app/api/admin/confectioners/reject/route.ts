/**
 * POST /api/admin/confectioners/reject — отказать кондитеру или запросить правки.
 * Body: { confectionerId, reason, requestRevision?: boolean }
 *
 * Логика:
 *   - requestRevision=true  → verification_status="needs_revision" (можно исправить)
 *   - requestRevision=false → verification_status="rejected" (полный отказ)
 *
 * После:
 *  - verified = false
 *  - verified_by = userId админа
 *  - rejection_reason = reason
 *  - отправляется уведомление кондитеру (push + email)
 *
 * Auth: ADMIN или SUPER_ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RejectRequestBody {
  confectionerId: string;
  reason: string;
  requestRevision?: boolean;
}

const MIN_REASON_LENGTH = 10;

/**
 * POST /api/admin/confectioners/reject — отказать кондитеру или запросить правки.
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

    const body = (await request.json()) as RejectRequestBody;
    const { confectionerId, reason, requestRevision } = body;

    // Валидация
    if (!confectionerId || typeof confectionerId !== "string") {
      return NextResponse.json(
        { error: "Укажите confectionerId" },
        { status: 400 }
      );
    }
    if (!reason || typeof reason !== "string" || reason.trim().length < MIN_REASON_LENGTH) {
      return NextResponse.json(
        { error: `Укажите причину (минимум ${MIN_REASON_LENGTH} символов)` },
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

    // Определить новый статус
    const newStatus: "needs_revision" | "rejected" = requestRevision ? "needs_revision" : "rejected";

    // Обновить кондитера
    const { error: updateErr } = await supabaseAdmin
      .from("confectioners")
      .update({
        verified: false,
        verificationStatus: newStatus,
        verifiedBy: user.id,
        rejectionReason: reason,
      })
      .eq("id", confectionerId);

    if (updateErr) {
      console.error("[admin/reject] update error:", updateErr.message);
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
        template: "ORDER_CANCELLED", // переиспользуем; в проде нужен отдельный шаблон
        vars: {
          orderNumber: conf.businessName,
          reason:
            newStatus === "needs_revision"
              ? `Запрошены правки: ${reason}`
              : `Профиль отклонён: ${reason}`,
        },
        data: {
          type: "confectioner_rejected",
          confectionerId: conf.id,
          status: newStatus,
          reason,
        },
      });
    } catch (e: any) {
      console.warn("[reject] Notification failed:", e?.message);
    }

    // Email-уведомление кондитеру (non-blocking)
    try {
      const { sendConfectionerVerificationEmail } = await import("@/lib/email-confectioner");
      await sendConfectionerVerificationEmail(
        confectionerId,
        newStatus === "needs_revision" ? "needs_revision" : "rejected",
        reason
      );
    } catch (e: any) {
      console.warn("[reject] Email failed:", e?.message);
    }

    console.info(
      `[admin] Confectioner ${conf.businessName} ${newStatus} by ${user.id}: ${reason}`
    );

    return NextResponse.json({
      success: true,
      confectionerId,
      status: newStatus,
      reason,
    });
  } catch (error: any) {
    console.error("POST /api/admin/confectioners/reject error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
