/**
 * /api/chat/rooms/[id]/messages — история и отправка сообщений комнаты.
 *
 * GET  — история (order by created_at ASC, limit≤200, ?before= курсор).
 * POST — отправка: { content } (+ Idempotency-Key из тела или заголовка).
 *        Колонка контента — chat_messages.text (0004, НЕ content/message).
 *        Идемпотентность (0040): уникальный индекс uq_chat_messages_idem по
 *        idempotency_key — конфликт 23505 возвращает существующую строку
 *        (тот же ответ, что и при первой отправке; дублей нет).
 *
 * Обновляет last_message_at / last_message_text канала (0004).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";
import {
  canAccessRoom,
  fetchChannel,
  fetchRoomMessages,
  type ApiChatMessage,
  type SupabaseError,
} from "@/lib/chat-rooms";

export const runtime = "nodejs";

const MAX_TEXT = 4000;

/** Тип комнаты для UI/бота (совместим со store ChatRoom.type). */
function mapChannelType(ch: { order_id: string | null; type: string }): string {
  if (ch.order_id) return "order";
  if (ch.type === "support") return "support";
  if (ch.type === "group") return "group";
  return "direct";
}

// ===== GET — история =====
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");
    const { id } = await params;

    const channel = await fetchChannel(id);
    if (!channel || channel.deleted_at) throw new HttpError(404, "Комната не найдена");
    if (!(await canAccessRoom(channel, user))) throw new HttpError(403, "Нет доступа к комнате");

    const sp = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "100", 10) || 100, 1), 200);
    const before = sp.get("before");

    const messages = await fetchRoomMessages(id, { limit, before });
    return NextResponse.json({ messages, total: messages.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

// ===== POST — отправка (идемпотентная) =====
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");
    const { id } = await params;

    const channel = await fetchChannel(id);
    if (!channel || channel.deleted_at) throw new HttpError(404, "Комната не найдена");
    if (!(await canAccessRoom(channel, user))) throw new HttpError(403, "Нет доступа к комнате");

    const { data: body, error: parseErr } = await safeJsonBody<{
      content?: string;
      text?: string;
      idempotencyKey?: string;
    }>(request);
    if (parseErr) throw new HttpError(400, parseErr);

    const content = (body?.content ?? body?.text ?? "").trim();
    if (!content) throw new HttpError(400, "Сообщение не может быть пустым");
    if (content.length > MAX_TEXT) {
      throw new HttpError(400, `Сообщение длиннее ${MAX_TEXT} символов`);
    }

    // Idempotency-Key: из тела или заголовка (chat-server форвардит клиентский uuid)
    const idempotencyKey =
      (body?.idempotencyKey || request.headers.get("Idempotency-Key") || "").trim() || null;
    if (idempotencyKey && idempotencyKey.length > 128) {
      throw new HttpError(400, "Idempotency-Key слишком длинный");
    }

    const insertPayload: Record<string, unknown> = {
      channel_id: id,
      sender_id: user.id,
      text: content,
      is_bot: false,
    };
    if (idempotencyKey) insertPayload.idempotency_key = idempotencyKey;

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("chat_messages")
      .insert(insertPayload)
      .select("*")
      .single() as {
      data: { id: string; created_at: string } | null;
      error: SupabaseError | null;
    };

    let messageId: string;
    let messageCreatedAt: string;
    let wasDuplicate = false;

    if (insertErr || !inserted) {
      // 23505 — unique conflict по idempotency_key: возвращаем существующую строку
      if (idempotencyKey && insertErr?.code === "23505") {
        const { data: existing } = await supabaseAdmin
          .from("chat_messages")
          .select("id, created_at, channel_id")
          .eq("idempotency_key", idempotencyKey)
          .limit(1) as {
          data: { id: string; created_at: string; channel_id: string }[] | null;
          error: SupabaseError | null;
        };
        const row = (existing || [])[0];
        if (row && row.channel_id === id) {
          messageId = row.id;
          messageCreatedAt = row.created_at;
          wasDuplicate = true;
        } else {
          throw new HttpError(409, "Конфликт идемпотентности");
        }
      } else {
        console.error("[chat/messages] insert:", insertErr?.message, insertErr?.code);
        throw new HttpError(500, "Не удалось отправить сообщение");
      }
    } else {
      messageId = inserted.id;
      messageCreatedAt = inserted.created_at;
    }

    // Метрики канала (0004: last_message_at / last_message_text)
    if (!wasDuplicate) {
      const { error: updErr } = await supabaseAdmin
        .from("chat_channels")
        .update({
          last_message_at: messageCreatedAt,
          last_message_text: content.slice(0, 120),
        })
        .eq("id", id);
      if (updErr) console.warn("[chat/messages] channel update:", updErr.message);
    }

    const message: ApiChatMessage = {
      id: messageId,
      roomId: id,
      text: content,
      senderId: user.id,
      senderName: user.name || "Пользователь",
      createdAt: messageCreatedAt,
      isBot: false,
    };
    return NextResponse.json({ message, duplicate: wasDuplicate, roomType: mapChannelType(channel) });
  } catch (error) {
    return handleRouteError(error);
  }
}
