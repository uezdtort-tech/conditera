/**
 * PATCH /api/moderation/queue/[id] — ручная модерация (одобрить/отклонить/эскалировать).
 *
 * Тело запроса: { manualStatus: "approved" | "rejected" | "escalated", moderatorComment?: string }
 *
 * При статусе "rejected" — отправляется email автору контента с причиной.
 * Всегда — Telegram-уведомление в канал модерации.
 *
 * Auth: ADMIN, MODERATOR или SUPPORT
 *
 * Соответствует таблицам:
 *  - moderation_queue (обновление manual_status, moderator_id, reviewed_at)
 *  - profiles (получение email автора)
 *  - через @/lib/email: sendTemplateEmail
 *  - через @/lib/telegram-bot: sendToChannel
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface PatchRequestBody {
  manualStatus: "approved" | "rejected" | "escalated";
  moderatorComment?: string;
}

const VALID_STATUSES = ["approved", "rejected", "escalated"] as const;

/**
 * PATCH /api/moderation/queue/:id — выполнить ручную модерацию.
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

    // Проверка роли — ADMIN, MODERATOR или SUPPORT
    const guard = await requireAnyRole(user.id, ["ADMIN", "MODERATOR", "SUPPORT"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = (await request.json()) as PatchRequestBody;
    const { manualStatus, moderatorComment } = body;

    // Валидация статуса
    if (!VALID_STATUSES.includes(manualStatus)) {
      return NextResponse.json(
        {
          error: "Неверный статус",
          expected: VALID_STATUSES,
          got: manualStatus,
        },
        { status: 400 }
      );
    }

    // Найти элемент
    const { data: item, error: fetchErr } = await supabaseAdmin
      .from("moderation_queue")
      .select("id, title, content_type, author_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !item) {
      return NextResponse.json(
        { error: "Элемент модерации не найден" },
        { status: 404 }
      );
    }

    // Обновить элемент
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("moderation_queue")
      .update({
        manual_status: manualStatus,
        moderator_id: user.id,
        moderator_name: user.name,
        moderator_comment: moderatorComment || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      console.error("[moderation/queue/:id] update error:", updateErr.message);
      return NextResponse.json(
        { error: "Database update failed", details: updateErr.message },
        { status: 500 }
      );
    }

    // Уведомление автора контента (только при rejected)
    if (manualStatus === "rejected" && item.author_id) {
      try {
        const { sendTemplateEmail } = await import("@/lib/email");
        const { data: author } = await supabaseAdmin
          .from("profiles")
          .select("email, name")
          .eq("id", item.author_id)
          .maybeSingle();

        if (author?.email) {
          await sendTemplateEmail("ticket_reply", {
            to: author.email,
            toName: author.name,
            params: {
              ticketNumber: "MOD-" + id.slice(-6),
              customerName: author.name,
              subject: `Контент отклонён модератором: ${item.title || item.content_type}`,
              replyText:
                `Ваш контент (${item.content_type}) отклонён модератором.\n\n` +
                `Причина: ${moderatorComment || "нарушение правил платформы"}\n\n` +
                `Если вы считаете это ошибкой — создайте тикет в поддержке.`,
              supporterName: user.name || "Служба модерации",
            },
          });
        }
      } catch (emailErr: any) {
        console.warn("[moderation] Email notification failed:", emailErr?.message);
      }
    }

    // Telegram-уведомление (non-blocking)
    try {
      const { sendToChannel } = await import("@/lib/telegram-bot");
      const statusEmoji =
        manualStatus === "approved" ? "✅" :
        manualStatus === "rejected" ? "❌" :
        "⏫";
      await sendToChannel(
        `${statusEmoji} <b>Контент проверен</b>\n\n` +
        `<b>Тип:</b> ${item.content_type}\n` +
        `<b>Решение:</b> ${manualStatus}\n` +
        `<b>Модератор:</b> ${user.name}\n` +
        (moderatorComment ? `<b>Комментарий:</b> ${moderatorComment}` : "")
      );
    } catch (tgErr: any) {
      console.warn("[moderation] Telegram notification failed:", tgErr?.message);
    }

    return NextResponse.json({ item: updated });
  } catch (error: any) {
    console.error("PATCH /api/moderation/queue/[id] error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
