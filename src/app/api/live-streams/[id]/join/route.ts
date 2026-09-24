/**
 * POST /api/live-streams/:id/join — зритель присоединился к стриму.
 * Атомарно увеличивает viewers_count + total_viewers и обновляет peak_viewers.
 *
 * Auth: AUTHENTICATED (или аноним с sessionId)
 *
 * Безопасность:
 *   • Counter increment атомарен (SQL UPDATE в одной транзакции через RPC)
 *     — нет race condition.
 *   • Анонимный sessionId генерируется с криптостойким random.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: streamId } = await params;
    if (!streamId) {
      return NextResponse.json({ error: "Stream ID required" }, { status: 400 });
    }

    const user = await getUserFromRequest(request);
    // Анониму генерируем стабильный sessionId (UUID v4) — безопаснее, чем Date.now()+random.
    const sessionId = request.nextUrl.searchParams.get("sessionId") || `anon-${randomUUID()}`;

    // Создаём запись о зрителе — даже если insert упадёт, продолжаем работать
    const { data: viewer, error: viewerErr } = await supabaseAdmin
      .from("live_stream_viewers")
      .insert({
        stream_id: streamId,
        user_id: user?.id || null,
        session_id: user?.id ? null : sessionId,
        joined_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (viewerErr) {
      console.warn("[live-streams/:id/join] viewer insert error:", viewerErr.message);
    }

    // Атомарно инкрементируем counters через RPC — нет race condition.
    const { data: newViewers, error: cntErr } = await supabaseAdmin
      .rpc("increment_live_viewers_full", { p_stream_id: streamId });

    if (cntErr) {
      console.error("[live-streams/:id/join] increment RPC failed:", cntErr.message);
    }

    if (newViewers === null || newViewers === undefined) {
      return NextResponse.json({ error: "Стрим не найден" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      viewerId: viewer?.id || null,
      sessionId,
      viewersCount: newViewers,
    });
  } catch (error: any) {
    console.error("[live-streams/:id/join] unhandled error:", error?.message);
    return NextResponse.json(
      { error: "Ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
