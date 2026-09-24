/**
 * POST /api/live-streams/:id/like — поставить лайк на стрим.
 * Атомарно увеличивает likes_count через RPC increment_live_likes.
 *
 * Auth: AUTHENTICATED
 *
 * Безопасность:
 *   • Counter increment атомарен (SQL UPDATE внутри RPC) — нет race condition.
 *   • RPC возвращает новое значение counter, которое мы и возвращаем клиенту.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: streamId } = await params;
    if (!streamId) {
      return NextResponse.json({ error: "Stream ID required" }, { status: 400 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Атомарный increment через RPC — возвращает новое значение counter.
    const { data: newCount, error } = await supabaseAdmin
      .rpc("increment_live_likes", { p_stream_id: streamId });

    if (error) {
      console.error("[live-streams/like] RPC failed:", error.message);
      return NextResponse.json(
        { error: "Не удалось поставить лайк", detail: error.message },
        { status: 500 }
      );
    }

    // RPC возвращает NULL, если стрим не найден (UPDATE не затронул строки).
    if (newCount === null || newCount === undefined) {
      return NextResponse.json({ error: "Стрим не найден" }, { status: 404 });
    }

    return NextResponse.json({ success: true, likesCount: newCount });
  } catch (error: any) {
    console.error("[live-streams/like] unhandled error:", error?.message);
    return NextResponse.json(
      { error: "Ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
