/**
 * POST   /api/notifications/push-subscribe — регистрация Web Push подписки
 * DELETE /api/notifications/push-subscribe?endpoint=... — отписка
 *
 * POST Body: { endpoint: string, keys: { p256dh: string, auth: string } }
 *
 * Аналогично /api/notifications/subscribe, но с обязательной авторизацией
 * и сохранением user-agent.
 *
 * Auth: AUTHENTICATED (только свои подписки)
 *
 * Соответствует таблице: push_subscriptions (unique по endpoint)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

interface PushSubscribeBody {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * POST /api/notifications/push-subscribe — зарегистрировать Web Push подписку.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = (await req.json()) as PushSubscribeBody;
    const { endpoint, keys } = body;

    // Валидация
    if (!endpoint || typeof endpoint !== "string") {
      return NextResponse.json(
        { error: "Missing endpoint" },
        { status: 400 }
      );
    }
    if (!keys?.p256dh || !keys?.auth) {
      return NextResponse.json(
        { error: "Missing keys.p256dh or keys.auth" },
        { status: 400 }
      );
    }

    // Upsert по endpoint (unique)
    const { data: sub, error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh_key: keys.p256dh,
          auth_key: keys.auth,
          user_agent: req.headers.get("user-agent") || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      )
      .select("id")
      .single();

    if (error) {
      console.error("[notifications/push-subscribe] upsert error:", error.message);
      return NextResponse.json(
        { error: "Database upsert failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, id: sub?.id });
  } catch (error: any) {
    console.error("POST /api/notifications/push-subscribe error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/notifications/push-subscribe?endpoint=... — отписаться.
 * Только для своих подписок (RLS по user_id).
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const endpoint = searchParams.get("endpoint");

    if (!endpoint) {
      return NextResponse.json(
        { error: "Missing endpoint query parameter" },
        { status: 400 }
      );
    }

    // Удалить подписку (только свою — через .eq("user_id", user.id))
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", user.id);

    if (error) {
      console.error("[notifications/push-subscribe] delete error:", error.message);
      return NextResponse.json(
        { error: "Database delete failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/notifications/push-subscribe error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
