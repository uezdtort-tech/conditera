/**
 * POST /api/stories/:id/view — отметить просмотр сторис.
 *
 * Аноним: только views_count++ (через RPC increment_story_views).
 * Авторизованный: уникальный просмотр через RPC register_unique_story_view,
 * который атомарно проверяет user_id в массиве viewed_by и инкрементирует counter.
 *
 * Auth: optional (AUTHENTICATED | anonymous)
 *
 * Безопасность:
 *   • Нет race condition — все операции в одной транзакции через RPC.
 *   • Гарантируется уникальность просмотров для авторизованных пользователей.
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
      // Анонимный просмотр — атомарный increment через RPC.
      const { data: newCount, error } = await supabaseAdmin
        .rpc("increment_story_views", { p_story_id: storyId });

      if (error) {
        console.error("[stories/view] increment_story_views RPC failed:", error.message);
      }

      if (newCount === null || newCount === undefined) {
        return NextResponse.json({ error: "Сторис не найдена" }, { status: 404 });
      }

      return NextResponse.json({ ok: true, unique: false, viewsCount: newCount });
    }

    // Авторизованный — атомарная регистрация уникального просмотра.
    // RPC вернёт true, если это новый уникальный просмотр, false — если уже смотрел.
    const { data: isUnique, error } = await supabaseAdmin
      .rpc("register_unique_story_view", {
        p_story_id: storyId,
        p_user_id: user.id,
      });

    if (error) {
      console.error("[stories/view] register_unique_story_view RPC failed:", error.message);
      return NextResponse.json(
        { error: "Не удалось зарегистрировать просмотр", detail: error.message },
        { status: 500 }
      );
    }

    // isUnique === null означает, что сторис не найдена (UPDATE не затронул строки).
    if (isUnique === null) {
      return NextResponse.json({ error: "Сторис не найдена" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, unique: Boolean(isUnique) });
  } catch (error: any) {
    console.error("[stories/view] unhandled error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
