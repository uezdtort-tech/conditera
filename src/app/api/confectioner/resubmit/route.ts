/**
 * POST /api/confectioner/resubmit — повторная отправка профиля на модерацию.
 *
 * Кондитер с verificationStatus = "rejected" или "needs_revision" может
 * исправить профиль и отправить снова. После этого статус → "pending".
 *
 * Логика:
 *   1. Найти кондитера по user_id
 *   2. Проверить, что статус не approved и не pending (иначе незачем отправлять)
 *   3. Валидация полноты профиля (businessName, description ≥30, avatar, city, legal_info, ≥3 фото)
 *   4. Сбросить статус в "pending", очистить rejection_reason и verified_by
 *   5. Попробовать авто-подтверждение через DaData (если ИП/ООО с ACTIVE)
 *   6. Уведомить всех админов (push + Telegram)
 *
 * Auth: CONFECTIONER
 *
 * Соответствует таблицам:
 *  - confectioners (обновление verification_status)
 *  - user_roles (поиск админов)
 *  - notifications (NEW_MESSAGE админам)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MIN_DESCRIPTION_LENGTH = 30;
const MIN_PORTFOLIO_IMAGES = 3;

/**
 * POST /api/confectioner/resubmit — повторная отправка профиля на модерацию.
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

    // Проверка роли — только CONFECTIONER
    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    // Найти кондитера по userId
    const { data: conf, error: fetchErr } = await supabaseAdmin
      .from("confectioners")
      .select(
        `
        id, userId, businessName, verificationStatus, description,
        avatar, city, legalInfo, specialization, portfolioImages
      `
      )
      .eq("userId", user.id)
      .maybeSingle();

    if (fetchErr || !conf) {
      return NextResponse.json(
        { error: "Профиль не найден" },
        { status: 404 }
      );
    }

    // Проверка статуса — только rejected или needs_revision могут повторно отправить
    if (conf.verificationStatus === "approved") {
      return NextResponse.json(
        { error: "Профиль уже подтверждён" },
        { status: 400 }
      );
    }
    if (conf.verificationStatus === "pending") {
      return NextResponse.json(
        { error: "Профиль уже на модерации" },
        { status: 400 }
      );
    }

    // Проверка минимальной полноты профиля
    const portfolioImages = (conf.portfolioImages as string[]) || [];
    const requiredChecks = [
      { ok: !!conf.businessName, msg: "Укажите название бизнеса" },
      {
        ok: !!conf.description && conf.description.length >= MIN_DESCRIPTION_LENGTH,
        msg: `Описание должно быть минимум ${MIN_DESCRIPTION_LENGTH} символов`,
      },
      { ok: !!conf.avatar, msg: "Загрузите аватар" },
      { ok: !!conf.city, msg: "Укажите город" },
      { ok: !!conf.legalInfo, msg: "Заполните юридическую информацию" },
      {
        ok: portfolioImages.length >= MIN_PORTFOLIO_IMAGES,
        msg: `Загрузите минимум ${MIN_PORTFOLIO_IMAGES} фото в портфолио`,
      },
    ];

    for (const check of requiredChecks) {
      if (!check.ok) {
        return NextResponse.json(
          { error: check.msg, field: "profile" },
          { status: 400 }
        );
      }
    }

    // Сбросить в pending
    const { error: updateErr } = await supabaseAdmin
      .from("confectioners")
      .update({
        verificationStatus: "pending",
        rejectionReason: null,
        verifiedBy: null,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", conf.id);

    if (updateErr) {
      console.error("[confectioner/resubmit] update error:", updateErr.message);
      return NextResponse.json(
        { error: "DB error", details: updateErr.message },
        { status: 500 }
      );
    }

    // Попытка авто-подтверждения через DaData (non-blocking)
    try {
      const { tryAutoApprove } = await import("@/lib/confectioner-auto-approve");
      const autoResult = await tryAutoApprove(conf.id);
      if (autoResult.autoApproved) {
        console.info(`[resubmit] Auto-approved: ${conf.businessName}`);
      }
    } catch (e: any) {
      console.warn("[resubmit] Auto-approve failed (non-blocking):", e?.message);
    }

    // Уведомление всем админам (push)
    try {
      // Найти всех пользователей с ролью ADMIN или SUPER_ADMIN
      const { data: adminRoles } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["ADMIN", "SUPER_ADMIN"])
        .eq("is_active", true);

      const { sendNotification } = await import("@/lib/notifications");
      for (const adminRole of adminRoles || []) {
        try {
          await sendNotification({
            userId: adminRole.user_id,
            template: "NEW_MESSAGE",
            vars: {
              senderName: "Новая заявка кондитера",
              text: `${conf.businessName} повторно отправил профиль на модерацию`,
            },
            data: {
              type: "confectioner_resubmitted",
              confectionerId: conf.id,
            },
          });
        } catch (notifErr: any) {
          console.warn("[resubmit] notification failed for admin:", adminRole.user_id, notifErr?.message);
        }
      }
    } catch (e: any) {
      console.warn("[resubmit] Admin notification failed:", e?.message);
    }

    // Telegram-уведомление админам (non-blocking)
    try {
      const { notifyNewConfectionerPending } = await import("@/lib/telegram-bot");
      // Получить email пользователя
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("id", conf.userId)
        .maybeSingle();

      await notifyNewConfectionerPending({
        confectionerId: conf.id,
        businessName: conf.businessName,
        city: conf.city || "",
        email: profile?.email || "",
        isResubmit: true,
      });
    } catch (e: any) {
      console.warn("[resubmit] Telegram notification failed:", e?.message);
    }

    return NextResponse.json({
      success: true,
      confectionerId: conf.id,
      status: "pending",
    });
  } catch (error: any) {
    console.error("POST /api/confectioner/resubmit error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
