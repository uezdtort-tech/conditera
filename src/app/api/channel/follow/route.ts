/**
 * POST /api/channel/follow — подписаться/отписаться от канала кондитера (toggle).
 *
 * Body: { confectionerId: string }
 * Toggle: если подписки нет — создаёт, если есть — удаляет.
 * Инкрементирует/декрементирует confectioners.followers_count через атомарный RPC.
 *
 * Auth: AUTHENTICATED
 *
 * Безопасность:
 *   • Toggle выполняется в одной транзакции через RPC toggle_follow_channel,
 *     что исключает race condition "read-then-write" на counter.
 *   • Подписка на самого себя отклоняется на уровне БД (RAISE EXCEPTION).
 *   • RPC является SECURITY DEFINER — RLS не влияет на операцию.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body.confectionerId !== "string") {
      return NextResponse.json({ error: "Укажите confectionerId" }, { status: 400 });
    }

    const confectionerId: string = body.confectionerId;
    if (confectionerId.length === 0) {
      return NextResponse.json({ error: "Укажите confectionerId" }, { status: 400 });
    }

    if (user.id === confectionerId) {
      return NextResponse.json({ error: "Нельзя подписаться на самого себя" }, { status: 400 });
    }

    // Атомарный toggle через RPC. Возвращает true — создана новая подписка,
    // false — удалена существующая. Идемпотентен при конкурентных вызовах.
    const { data: following, error } = await supabaseAdmin
      .rpc("toggle_follow_channel", {
        p_confectioner_id: confectionerId,
        p_user_id: user.id,
      });

    if (error) {
      console.error("[channel/follow] RPC failed:", error.message);
      return NextResponse.json(
        { error: "Не удалось обновить подписку", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, following: Boolean(following) });
  } catch (error: any) {
    console.error("[channel/follow] unhandled error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
