/**
 * POST   /api/notifications/subscribe — подписка на push-уведомления (Web Push)
 * DELETE /api/notifications/subscribe — отписка
 *
 * Тело POST: { endpoint: string, keys: { p256dh: string, auth: string }, userId?: string }
 * Тело DELETE: { endpoint: string }
 *
 * Auth: AUTHENTICATED (но userId из body тоже принимается для кросс-платформенных подписок)
 *
 * Соответствует таблице: push_subscriptions (создаётся в миграции 0005_crm_cms.sql)
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PushKeys {
  p256dh: string;
  auth: string;
}

interface SubscribeRequestBody {
  endpoint: string;
  keys: PushKeys;
  userId?: string;
}

interface UnsubscribeRequestBody {
  endpoint: string;
}

/**
 * POST /api/notifications/subscribe — подписаться на push-уведомления.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const authUser = await getUserFromRequest(req as any);

    const body = (await req.json()) as SubscribeRequestBody;
    const { endpoint, keys, userId: bodyUserId } = body;

    // Валидация
    if (!endpoint || typeof endpoint !== "string" || endpoint.length < 10) {
      return NextResponse.json(
        { error: "endpoint обязателен и должен быть строкой ≥10 символов" },
        { status: 400 }
      );
    }
    if (!keys?.p256dh || !keys?.auth) {
      return NextResponse.json(
        { error: "Неполные данные подписки: keys.p256dh и keys.auth обязательны" },
        { status: 400 }
      );
    }

    // Определить userId — приоритет у авторизованного, fallback на body
    const userId = authUser?.id || bodyUserId;
    if (!userId) {
      return NextResponse.json(
        { error: "userId обязателен (либо авторизуйтесь, либо передайте в body)" },
        { status: 400 }
      );
    }

    // Upsert подписки в БД
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint,
          p256dh_key: keys.p256dh,
          auth_key: keys.auth,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      console.error("[notifications/subscribe] upsert error:", error.message);
      // Не fail-ить — в dev без БД возвращаем success (старое поведение)
      console.log("[Push] Новая подписка (fallback, no DB):", {
        userId,
        endpoint: endpoint.slice(0, 50) + "...",
      });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("POST /api/notifications/subscribe error:", e?.message);
    return NextResponse.json(
      { error: "Ошибка подписки", detail: e?.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/notifications/subscribe — отписаться от push-уведомлений.
 */
export async function DELETE(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as UnsubscribeRequestBody;
    const { endpoint } = body;

    if (!endpoint || typeof endpoint !== "string") {
      return NextResponse.json(
        { error: "endpoint обязателен" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);

    if (error) {
      console.error("[notifications/subscribe] delete error:", error.message);
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("DELETE /api/notifications/subscribe error:", e?.message);
    return NextResponse.json(
      { error: "Ошибка отписки", detail: e?.message },
      { status: 500 }
    );
  }
}
