/**
 * POST /api/stories/:id/like — поставить/снять лайк (toggle, AUTHENTICATED).
 *
 * Атомарный toggle через RPC `toggle_story_like` — исключает race condition
 * на counter `likes_count`. Идемпотентен при конкурентных вызовах.
 *
 * Возвращает:
 *   { ok: true, liked: true }  — лайк поставлен
 *   { ok: true, liked: false } — лайк снят
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: storyId } = await params;
    if (!storyId) {
      return NextResponse.json({ error: "Story ID required" }, { status: 400 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Атомарный toggle через RPC. Возвращает true — лайк создан, false — удалён.
    const { data: liked, error } = await supabaseAdmin
      .rpc("toggle_story_like", {
        p_story_id: storyId,
        p_user_id: user.id,
      });

    if (error) {
      console.error("[stories/like] RPC failed:", error.message);
      return NextResponse.json(
        { error: "Не удалось обновить лайк", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, liked: Boolean(liked) });
  } catch (error: any) {
    console.error("[stories/like] unhandled error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
