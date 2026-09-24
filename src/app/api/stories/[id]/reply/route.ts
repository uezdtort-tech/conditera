/**
 * POST /api/stories/:id/reply — ответ на сторис (AUTHENTICATED).
 * Body: { text: string }
 *
 * Безопасность:
 *   • Text валидируется по длине (1-500 символов).
 *   • replies_count увеличивается атомарно через RPC.
 *   • При неудаче insert возвращается явная ошибка без утечки деталей БД.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

const MAX_REPLY_LENGTH = 500;

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

    const body = await request.json().catch(() => null);
    if (!body || typeof body.text !== "string") {
      return NextResponse.json({ error: "Укажите text" }, { status: 400 });
    }

    const text: string = body.text.trim();
    if (text.length === 0) {
      return NextResponse.json({ error: "Укажите text" }, { status: 400 });
    }
    if (text.length > MAX_REPLY_LENGTH) {
      return NextResponse.json(
        { error: `Ответ слишком длинный (макс ${MAX_REPLY_LENGTH} символов)` },
        { status: 400 }
      );
    }

    const { data: reply, error } = await supabaseAdmin
      .from("story_replies")
      .insert({
        story_id: storyId,
        user_id: user.id,
        user_name: user.name || "Аноним",
        text,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[stories/reply] insert failed:", error.message);
      return NextResponse.json(
        { error: "Не удалось сохранить ответ" },
        { status: 500 }
      );
    }

    // Атомарный increment replies_count через RPC — нет race condition.
    const { error: cntErr } = await supabaseAdmin
      .rpc("increment_story_replies", { p_story_id: storyId });

    if (cntErr) {
      console.warn("[stories/reply] counter increment failed:", cntErr.message);
      // Non-fatal — reply уже создан, counter можно пересчитать позже.
    }

    return NextResponse.json({ reply }, { status: 201 });
  } catch (error: any) {
    console.error("[stories/reply] unhandled error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
