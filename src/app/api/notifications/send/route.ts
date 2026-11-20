/**
 * GET  /api/notifications/send — список последних уведомлений (alias для /list)
 * POST /api/notifications/send — отправка уведомления (только ADMIN/SUPER_ADMIN)
 *
 * Тело POST: { userId: string, type: string, title: string, body: string, data?: Record<string, unknown> }
 *
 * Auth: ADMIN или SUPER_ADMIN для POST
 *
 * Соответствует таблицам:
 *  - notifications (создание записи)
 *  - push_subscriptions (для отправки Web Push)
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { isAllowedPushEndpoint } from "@/lib/push-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SendRequestBody {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channel?: "in_app" | "push" | "email" | "sms" | "telegram";
  // n8n compatibility: template + vars → converts to title/body
  template?: string;
  vars?: Record<string, unknown>;
  channels?: string[];
}

// Template → title/body mapping (for n8n workflows)
const TEMPLATE_MAP: Record<string, { title: string; body: string }> = {
  ABANDONED_CART: {
    title: "Вы забыли корзину!",
    body: "В вашей корзине остались товары. Завершите заказ, пока они не закончились!",
  },
  WEEKLY_DIGEST: {
    title: "Ваш еженедельный дайджест",
    body: "Новые торты, акции и рецепты за эту неделю — внутри!",
  },
  BONUS_EXPIRING: {
    title: "Бонусы сгорают!",
    body: "У вас сгорают бонусы. Используйте их при следующем заказе!",
  },
  REENGAGEMENT: {
    title: "Мы скучаем по вам!",
    body: "Давно не видели вас. Загляните — у нас новинки и скидки!",
  },
  REVIEW_REQUEST: {
    title: "Оставьте отзыв",
    body: "Как вам последний заказ? Поделитесь впечатлениями!",
  },
};

/**
 * GET /api/notifications/send — алиас для /list (последние 50 уведомлений).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("[notifications/send GET] query error:", error.message);
    return NextResponse.json({ notifications: [] });
  }

  return NextResponse.json({ notifications: data || [] });
}

/**
 * POST /api/notifications/send — отправить уведомление пользователю.
 * Только ADMIN или SUPER_ADMIN.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — ADMIN или SUPER_ADMIN
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = (await req.json()) as SendRequestBody;

    // n8n compatibility: if template is provided, convert to title/body
    let finalTitle = body.title;
    let finalBody = body.body;
    let finalType = body.type;

    if (body.template && !finalTitle) {
      const templateInfo = TEMPLATE_MAP[body.template];
      if (templateInfo) {
        finalTitle = templateInfo.title;
        finalBody = templateInfo.body;
        finalType = body.template.toLowerCase();
      } else {
        finalTitle = body.template;
        finalBody = body.template;
        finalType = body.template.toLowerCase();
      }
    }

    // This endpoint currently delivers one channel only. Do not silently
    // report success for email/SMS/Telegram or multi-channel requests.
    const requestedChannels = Array.isArray(body.channels) && body.channels.length > 0
      ? body.channels
      : [body.channel || "in_app"];
    if (
      requestedChannels.length !== 1 ||
      requestedChannels.some((channel) => channel !== "in_app" && channel !== "push")
    ) {
      return NextResponse.json(
        { error: "Unsupported notification channel; this endpoint supports one channel: in_app or push" },
        { status: 501 }
      );
    }
    const finalChannel = requestedChannels[0] as "in_app" | "push";
    const shouldSendPush = finalChannel === "push";
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    if (shouldSendPush && (!vapidPublicKey || !vapidPrivateKey)) {
      return NextResponse.json({ error: "Web Push VAPID keys are not configured" }, { status: 503 });
    }

    let webpushClient: (typeof import("web-push"))["default"] | null = null;
    if (shouldSendPush) {
      try {
        webpushClient = (await import("web-push")).default;
        webpushClient.setVapidDetails(
          `mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "noreply@conditera.ru"}`,
          vapidPublicKey!,
          vapidPrivateKey!,
        );
      } catch (error) {
        console.error("[notifications/send] Web Push initialization failed:", error);
        return NextResponse.json({ error: "Web Push provider is unavailable" }, { status: 503 });
      }
    }

    const { userId, data } = body;

    // Валидация
    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "userId обязателен" },
        { status: 400 }
      );
    }
    if (!finalTitle || typeof finalTitle !== "string") {
      return NextResponse.json(
        { error: "title обязателен" },
        { status: 400 }
      );
    }
    if (!finalBody || typeof finalBody !== "string") {
      return NextResponse.json(
        { error: "body обязателен" },
        { status: 400 }
      );
    }

    // Сохранить уведомление в БД (схема 0010: metadata вместо data)
    const { data: notif, error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: userId,
        type: finalType || "info",
        title: finalTitle,
        body: finalBody,
        metadata: data || {},
        channel: finalChannel,
        status: "sent",
      })
      .select("id")
      .single();

    if (notifErr) {
      console.error("[notifications/send] insert error:", notifErr.message);
      return NextResponse.json(
        { error: "Database insert failed", details: notifErr.message },
        { status: 500 }
      );
    }

    let pushSent = 0;
    let pushFailed = 0;
    if (webpushClient) {
      const { data: subscriptions, error: subscriptionsError } = await supabaseAdmin
        .from("push_subscriptions")
        .select("endpoint, keys")
        .eq("user_id", userId);

      if (subscriptionsError) {
        console.error("[notifications/send] subscription lookup failed:", subscriptionsError.message);
        await supabaseAdmin.from("notifications").update({ status: "failed" }).eq("id", notif.id);
        return NextResponse.json({ error: "Could not load push subscriptions" }, { status: 502 });
      }

      for (const sub of subscriptions || []) {
        if (!isAllowedPushEndpoint(sub.endpoint)) {
          console.warn("[notifications/send] skipped invalid push endpoint:", String(sub.endpoint).slice(0, 80));
          continue;
        }
        const keys = (sub.keys || {}) as { p256dh?: string; auth?: string };
        if (!keys.p256dh || !keys.auth) continue;
        try {
          await webpushClient.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: keys.p256dh, auth: keys.auth },
            },
            JSON.stringify({ title: finalTitle, body: finalBody, data })
          );
          pushSent += 1;
        } catch (pushError) {
          pushFailed += 1;
          console.warn("[notifications/send] push failed for endpoint:", sub.endpoint.slice(0, 50), pushError);
        }
      }

      if (pushFailed > 0 && pushSent === 0) {
        await supabaseAdmin.from("notifications").update({ status: "failed" }).eq("id", notif.id);
        return NextResponse.json({ error: "Web Push delivery failed", pushSent, pushFailed }, { status: 502 });
      }
    }

    return NextResponse.json({
      success: true,
      notificationId: notif?.id,
      ...(shouldSendPush ? { pushSent, pushFailed } : {}),
    });
  } catch (e: any) {
    console.error("POST /api/notifications/send error:", e?.message);
    return NextResponse.json(
      { error: "Ошибка отправки", detail: e?.message },
      { status: 500 }
    );
  }
}
