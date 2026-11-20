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
import { isAllowedPushEndpoint } from "@/lib/push-subscriptions";

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
    const authUser = await getUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = (await req.json()) as SubscribeRequestBody;
    const { endpoint, keys, userId: bodyUserId } = body;

    // Валидация
    if (!endpoint || typeof endpoint !== "string" || endpoint.length > 4096 || !isAllowedPushEndpoint(endpoint)) {
      return NextResponse.json(
        { error: "endpoint обязателен и должен быть строкой ≥10 символов" },
        { status: 400 }
      );
    }
    if (
      typeof keys?.p256dh !== "string" || !/^[A-Za-z0-9_-]{16,512}$/.test(keys.p256dh) ||
      typeof keys?.auth !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(keys.auth)
    ) {
      return NextResponse.json(
        { error: "Неполные данные подписки: keys.p256dh и keys.auth обязательны" },
        { status: 400 }
      );
    }

    if (bodyUserId && bodyUserId !== authUser.id) {
      return NextResponse.json({ error: "Нельзя подписывать другой аккаунт" }, { status: 403 });
    }
    const userId = authUser.id;

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("user_id")
      .eq("endpoint", endpoint)
      .maybeSingle();
    if (lookupError) {
      console.error("[notifications/subscribe] ownership lookup failed:", lookupError.message);
      return NextResponse.json({ error: "Database lookup failed" }, { status: 500 });
    }
    if (existing && existing.user_id !== userId) {
      return NextResponse.json({ error: "Push endpoint already belongs to another account" }, { status: 409 });
    }

    // Upsert подписки только после проверки владельца.
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint,
          // Реальная схема: keys jsonb вида { p256dh, auth }
          keys: { p256dh: keys.p256dh, auth: keys.auth },
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      console.error("[notifications/subscribe] upsert error:", error.message);
      return NextResponse.json({ error: "Database upsert failed" }, { status: 500 });
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
    const authUser = await getUserFromRequest(req);
    if (!authUser) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const body = (await req.json()) as UnsubscribeRequestBody;
    const { endpoint } = body;

    if (!endpoint || typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint)) {
      return NextResponse.json({ error: "Некорректный endpoint" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", authUser.id);

    if (error) {
      console.error("[notifications/subscribe] delete error:", error.message);
      return NextResponse.json({ error: "Database delete failed" }, { status: 500 });
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
