/**
 * POST /api/channel/auto-post — cron-задача: авто-публикация одобренных постов в Telegram.
 *
 * Находит все посты с moderation_status="approved" и telegram_message_id IS NULL,
 * публикует их в Telegram-канал, сохраняет telegram_message_id.
 *
 * Запуск: через cron (например, каждые 30 минут) или вручную админом.
 *
 * Auth: CRON_SECRET или ADMIN
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import { verifyCronSecret } from "@/lib/cron-auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError { message: string }

interface PostRow {
  id: string;
  confectioner_id: string;
  content: string;
  images: string[] | null;
  is_pinned: boolean | null;
}

interface ConfectionerRow {
  id: string;
  business_name: string;
  city: string | null;
}

const MAX_POSTS_PER_RUN = 10;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Auth: cron-secret или admin
    const isCron = verifyCronSecret(request);
    if (!isCron) {
      const user = await getUserFromRequest(request);
      if (!user) throw new HttpError(401, "Не авторизован");
      const adminCheck = await isAdmin(user.userId);
      if (!adminCheck) throw new HttpError(403, "Только для админов");
    }

    // Находим одобренные посты без telegram_message_id
    const { data: posts, error } = await supabaseAdmin
      .from("channel_posts")
      .select("id, confectioner_id, content, images, is_pinned")
      .eq("moderation_status", "approved")
      .is("telegram_message_id", null)
      .eq("is_published", true)
      .order("published_at", { ascending: true })
      .limit(MAX_POSTS_PER_RUN) as { data: PostRow[] | null; error: SupabaseError | null };

    if (error) {
      console.error("[auto-post] query failed:", error.message);
      throw new HttpError(500, "Не удалось получить посты");
    }

    if (!posts || posts.length === 0) {
      return NextResponse.json({ success: true, posted: 0, message: "Нет постов для публикации" });
    }

    // Загружаем кондитеров сразу
    const confectionerIds = [...new Set(posts.map((p) => p.confectioner_id))];
    const { data: confectioners } = await supabaseAdmin
      .from("confectioners")
      .select("id, business_name, city")
      .in("id", confectionerIds) as { data: ConfectionerRow[] | null; error: SupabaseError | null };

    const confMap = new Map<string, ConfectionerRow>();
    for (const c of confectioners || []) {
      confMap.set(c.id || "", c);
    }

    const { sendToChannel } = await import("@/lib/telegram-bot");
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://conditera.ru";

    let posted = 0;
    let failed = 0;
    const results: Array<{ postId: string; success: boolean; error?: string }> = [];

    for (const post of posts) {
      const conf = confMap.get(post.confectioner_id);
      const businessName = conf?.business_name || "Кондитер";
      const city = conf?.city ? ` (${conf.city})` : "";
      const images = post.images || [];

      // Формируем текст
      let tgText = `🍰 <b>${businessName}</b>${city}\n\n`;
      tgText += post.content;
      if (images.length > 0) {
        tgText += `\n\n📷 Фото: ${images.length}`;
      }
      tgText += `\n\n🌐 <a href="${APP_URL}/confectioners">Больше работ на «Кондитере»</a>`;

      try {
        const sent = await sendToChannel(tgText) as boolean;

        if (sent) {
          // Обновляем пост
          await supabaseAdmin
            .from("channel_posts")
            .update({
              telegram_posted_at: new Date().toISOString(),
              telegram_post_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", post.id);

          posted++;
          results.push({ postId: post.id, success: true });
          console.info(`[auto-post] ✓ Post ${post.id} published to TG`);
        } else {
          await supabaseAdmin
            .from("channel_posts")
            .update({
              telegram_post_error: "sendToChannel returned false",
              updated_at: new Date().toISOString(),
            })
            .eq("id", post.id);

          failed++;
          results.push({ postId: post.id, success: false, error: "sendToChannel returned false" });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[auto-post] Post ${post.id} failed:`, msg);

        await supabaseAdmin
          .from("channel_posts")
          .update({
            telegram_post_error: msg.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", post.id);

        failed++;
        results.push({ postId: post.id, success: false, error: msg });
      }

      // Задержка между постами (чтобы не заспамить канал)
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return NextResponse.json({
      success: true,
      total: posts.length,
      posted,
      failed,
      results,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
