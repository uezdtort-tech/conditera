/**
 * GET  /api/live-streams/:id/chat — получить чат стрима (последние 50 сообщений)
 * POST /api/live-streams/:id/chat — отправить сообщение в чат стрима
 *
 * Auth: GET AUTHENTICATED, POST AUTHENTICATED
 *
 * Безопасность:
 *   • POST: парсинг JSON безопасен (safeJsonBody), возвращает 400 при невалидном JSON.
 *   • POST: текст валидируется по длине (1-1000 символов) и типу (string).
 *   • При insert error не возвращаем детали БД клиенту (только общую ошибку).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError, readStringField } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

const MAX_MESSAGE_LENGTH = 1000;

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: streamId } = await params;
    if (!streamId) {
      throw new HttpError(400, "Stream ID required");
    }

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: messages, error } = await supabaseAdmin
      .from("live_stream_messages")
      .select("*")
      .eq("stream_id", streamId)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) {
      console.warn("[live-streams/:id/chat] GET error:", error.message);
    }

    return NextResponse.json({ messages: messages || [] });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: streamId } = await params;
    if (!streamId) {
      throw new HttpError(400, "Stream ID required");
    }

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseErr } = await safeJsonBody<Record<string, unknown>>(request);
    if (parseErr || !body) {
      throw new HttpError(400, parseErr || "Тело запроса обязательно");
    }

    const { value: text, error: textErr } = readStringField(body, "text", {
      required: true,
      maxLength: MAX_MESSAGE_LENGTH,
    });
    if (textErr || !text) {
      throw new HttpError(400, textErr || "Укажите text");
    }

    const { data: message, error } = await supabaseAdmin
      .from("live_stream_messages")
      .insert({
        stream_id: streamId,
        user_id: user.id,
        user_name: user.name || "Аноним",
        text,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[live-streams/:id/chat] insert failed:", error.message);
      throw new HttpError(500, "Не удалось сохранить сообщение");
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
