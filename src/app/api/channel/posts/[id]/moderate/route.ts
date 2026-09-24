/**
 * POST /api/channel/posts/:id/moderate — модерация публикации кондитера.
 *
 * Body: { action: "approve" | "reject", rejectionReason?: string, autoPostToTelegram?: boolean }
 *
 * При approve:
 *   • moderation_status → "approved"
 *   • is_published → true (пост виден в ленте)
 *   • Если autoPostToTelegram=true (по умолчанию) — публикация в TG-канал
 *     через sendToChannel(), сохраняется telegram_message_id
 *
 * При reject:
 *   • moderation_status → "rejected"
 *   • is_published → false (пост скрыт)
 *   • Сохраняется rejection_reason
 *
 * Auth: ADMIN или SUPER_ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }> }
interface SupabaseError { message: string }

const MODERATION_ACTIONS = ["approve", "reject"] as const;

interface PostRow {
  id: string;
  confectioner_id: string;
  content: string;
  images: string[] | null;
  is_published: boolean | null;
  moderation_status: string | null;
  telegram_message_id: number | null;
}

interface ConfectionerRow {
  business_name: string;
  avatar: string | null;
}

interface ModerateBody {
  action?: string;
  rejectionReason?: string;
  autoPostToTelegram?: boolean;
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: postId } = await params;
    if (!postId) throw new HttpError(400, "Post ID required");

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const guard = await requireAnyRole(user.userId, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    const { data: body, error: parseErr } = await safeJsonBody<ModerateBody>(request);
    if (parseErr) throw new HttpError(400, parseErr);
    if (!body) throw new HttpError(400, "Тело обязательно");

    const actionResult = readEnumField({ action: body.action }, "action", MODERATION_ACTIONS, { required: true });
    if (actionResult.error || !actionResult.value) {
      throw new HttpError(422, actionResult.error || `action должен быть approve или reject`);
    }
    const action = actionResult.value;

    // Загружаем пост
    const { data: post, error: postErr } = await supabaseAdmin
      .from("channel_posts")
      .select("*")
      .eq("id", postId)
      .maybeSingle() as { data: PostRow | null; error: SupabaseError | null };

    if (postErr) {
      console.error("[moderate] lookup failed:", postErr.message);
      throw new HttpError(500, "Не удалось найти публикацию");
    }
    if (!post) throw new HttpError(404, "Публикация не найдена");

    if (action === "reject") {
      // Отклонение
      const { error: updErr } = await supabaseAdmin
        .from("channel_posts")
        .update({
          moderation_status: "rejected",
          is_published: false,
          moderated_by: user.userId,
          moderated_at: new Date().toISOString(),
          rejection_reason: body.rejectionReason || "Отклонено администратором",
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId);

      if (updErr) {
        console.error("[moderate] reject update failed:", updErr.message);
        throw new HttpError(500, "Не удалось отклонить публикацию");
      }

      // Уведомляем кондитера
      try {
        const { sendNotification } = await import("@/lib/notifications");
        await sendNotification({
          userId: post.confectioner_id,
          template: "VERIFICATION_REJECTED",
          vars: {
            reason: body.rejectionReason || "Публикация не соответствует правилам платформы",
          },
          data: { postId, type: "post_rejected" },
        });
      } catch (e) {
        console.warn("[moderate] notification failed:", e);
      }

      return NextResponse.json({ success: true, action: "rejected", postId });
    }

    // === APPROVE ===
    const shouldPostToTelegram = body.autoPostToTelegram !== false;
    let telegramMessageId: number | null = null;
    let telegramError: string | null = null;

    if (shouldPostToTelegram) {
      // Загружаем кондитера для имени
      const { data: conf } = await supabaseAdmin
        .from("confectioners")
        .select("business_name, avatar")
        .eq("id", post.confectioner_id)
        .maybeSingle() as { data: ConfectionerRow | null; error: SupabaseError | null };

      const businessName = conf?.business_name || "Кондитер";
      const images = post.images || [];

      // Формируем текст для Telegram
      let tgText = `🍰 <b>${businessName}</b>\n\n`;
      tgText += post.content;
      if (images.length > 0) {
        tgText += `\n\n📷 Фото: ${images.length}`;
      }
      tgText += `\n\n🌐 <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://conditera.ru"}/confectioners">Больше работ на «Кондитере»</a>`;

      // Публикуем в Telegram-канал
      try {
        const { sendToChannel } = await import("@/lib/telegram-bot");
        const sent = await sendToChannel(tgText) as boolean;
        if (sent) {
          console.info(`[moderate] Post ${postId} published to Telegram channel`);
        } else {
          telegramError = "sendToChannel returned false";
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[moderate] Telegram post failed:", msg);
        telegramError = msg.slice(0, 500);
      }
    }

    // Обновляем пост
    const { error: updErr } = await supabaseAdmin
      .from("channel_posts")
      .update({
        moderation_status: "approved",
        is_published: true,
        moderated_by: user.userId,
        moderated_at: new Date().toISOString(),
        rejection_reason: null,
        telegram_message_id: telegramMessageId,
        telegram_posted_at: telegramMessageId ? new Date().toISOString() : null,
        telegram_post_error: telegramError,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);

    if (updErr) {
      console.error("[moderate] approve update failed:", updErr.message);
      throw new HttpError(500, "Не удалось одобрить публикацию");
    }

    // Уведомляем кондитера
    try {
      const { sendNotification } = await import("@/lib/notifications");
      await sendNotification({
        userId: post.confectioner_id,
        template: "VERIFICATION_APPROVED",
        vars: {},
        data: { postId, type: "post_approved", telegramPosted: Boolean(telegramMessageId) },
      });
    } catch (e) {
      console.warn("[moderate] notification failed:", e);
    }

    return NextResponse.json({
      success: true,
      action: "approved",
      postId,
      telegramPosted: Boolean(telegramMessageId),
      telegramError,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
