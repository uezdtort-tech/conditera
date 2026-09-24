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

    // n8n channels → single channel
    const finalChannel = body.channel || (body.channels?.[0] as SendRequestBody["channel"]) || "in_app";

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

    // Сохранить уведомление в БД
    const { data: notif, error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: userId,
        type: finalType || "info",
        title: finalTitle,
        body: finalBody,
        data: data || {},
        channel: finalChannel,
        status: "sent",
        created_at: new Date().toISOString(),
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

    // Отправить Web Push через подписки (non-blocking)
    try {
      const webpush = (await import("web-push")).default;
      const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
      const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

      if (vapidPublicKey && vapidPrivateKey) {
        webpush.setVapidDetails(
          `mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "noreply@example.com"}`,
          vapidPublicKey,
          vapidPrivateKey
        );

        // Получить подписки пользователя
        const { data: subscriptions } = await supabaseAdmin
          .from("push_subscriptions")
          .select("endpoint, p256dh_key, auth_key")
          .eq("user_id", userId);

        for (const sub of subscriptions || []) {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh_key,
                  auth: sub.auth_key,
                },
              },
              JSON.stringify({ title: finalTitle, body: finalBody, data })
            );
          } catch (pushErr: any) {
            console.warn("[notifications/send] push failed for endpoint:", sub.endpoint.slice(0, 50), pushErr?.message);
          }
        }
      }
    } catch (importErr: any) {
      console.warn("[notifications/send] web-push not available (non-blocking):", importErr?.message);
    }

    return NextResponse.json({
      success: true,
      notificationId: notif?.id,
    });
  } catch (e: any) {
    console.error("POST /api/notifications/send error:", e?.message);
    return NextResponse.json(
      { error: "Ошибка отправки", detail: e?.message },
      { status: 500 }
    );
  }
}
