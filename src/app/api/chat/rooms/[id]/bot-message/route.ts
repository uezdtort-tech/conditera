/**
 * POST /api/chat/rooms/[id]/bot-message — персистенция bot-сообщений
 * (server-to-server из mini-services/chat-server).
 *
 * Зачем: chat_messages.sender_id NOT NULL + FK → auth.users, поэтому бот не
 * может писать через обычный /messages (нет bot-JWT). Все bot-сообщения
 * пишутся от имени системного пользователя (seed 0004_seed_bot_user.sql,
 * is_bot=true, bot_kind='faq'|'escalation') — история бота переживает
 * рестарт chat-server и видна в GET /messages.
 *
 * Auth: заголовок x-bot-secret vs BOT_SECRET (timing-safe). BOT_SECRET не
 * задан → 503 (fail-closed: маршрут физически не работает без секрета).
 * CSRF: клиент chat-server получает пару через GET /api/csrf-token (как и
 * для /messages) — глобальный гейт src/proxy.ts остаётся неизменным.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";
import {
  fetchChannel,
  mapChannelTypeForBot,
  BOT_USER_ID,
  type SupabaseError,
} from "@/lib/chat-rooms";

export const runtime = "nodejs";

const MAX_TEXT = 4000;

function botSecretMatches(headerValue: string | null): boolean {
  const expected = process.env.BOT_SECRET || "";
  if (!expected || !headerValue) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headerValue, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    if (!botSecretMatches(request.headers.get("x-bot-secret"))) {
      // 503 (а не 401/403) — не раскрываем, что маршрут существует; для
      // легитимного chat-server 503 = «BOT_SECRET не настроен на Next.js».
      throw new HttpError(503, "Bot-канал недоступен");
    }

    const { id } = await params;
    const channel = await fetchChannel(id);
    if (!channel || channel.deleted_at) throw new HttpError(404, "Комната не найдена");

    const { data: body, error: parseErr } = await safeJsonBody<{
      text?: string;
      botKind?: string;
      quickReplies?: { label: string; action: string; payload?: unknown }[];
      idempotencyKey?: string;
    }>(request);
    if (parseErr) throw new HttpError(400, parseErr);

    const text = (body?.text || "").trim();
    if (!text) throw new HttpError(400, "Сообщение не может быть пустым");
    if (text.length > MAX_TEXT) {
      throw new HttpError(400, `Сообщение длиннее ${MAX_TEXT} символов`);
    }
    const botKind = body?.botKind === "escalation" ? "escalation" : "faq";
    const quickReplies = Array.isArray(body?.quickReplies)
      ? body!.quickReplies!.slice(0, 8)
      : null;

    const idempotencyKey =
      (body?.idempotencyKey || request.headers.get("Idempotency-Key") || "").trim() || null;
    if (idempotencyKey && idempotencyKey.length > 128) {
      throw new HttpError(400, "Idempotency-Key слишком длинный");
    }

    const insertPayload: Record<string, unknown> = {
      channel_id: id,
      sender_id: BOT_USER_ID,
      text,
      is_bot: true,
      bot_kind: botKind,
    };
    if (quickReplies) insertPayload.quick_replies = quickReplies;
    if (idempotencyKey) insertPayload.idempotency_key = idempotencyKey;

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("chat_messages")
      .insert(insertPayload)
      .select("id, created_at")
      .single() as {
      data: { id: string; created_at: string } | null;
      error: SupabaseError | null;
    };

    let messageId: string;
    let createdAt: string;
    let wasDuplicate = false;

    if (insertErr || !inserted) {
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
          createdAt = row.created_at;
          wasDuplicate = true;
        } else {
          throw new HttpError(409, "Конфликт идемпотентности");
        }
      } else {
        console.error("[chat/bot-message] insert:", insertErr?.message, insertErr?.code);
        throw new HttpError(500, "Не удалось сохранить сообщение бота");
      }
    } else {
      messageId = inserted.id;
      createdAt = inserted.created_at;
    }

    if (!wasDuplicate) {
      const { error: updErr } = await supabaseAdmin
        .from("chat_channels")
        .update({ last_message_at: createdAt, last_message_text: text.slice(0, 120) })
        .eq("id", id);
      if (updErr) console.warn("[chat/bot-message] channel update:", updErr.message);
    }

    return NextResponse.json({
      message: {
        id: messageId,
        roomId: id,
        text,
        senderId: BOT_USER_ID,
        senderName: "Уездный помощник",
        createdAt,
        isBot: true,
        botKind,
        quickReplies: quickReplies || undefined,
      },
      duplicate: wasDuplicate,
      roomType: mapChannelTypeForBot(channel),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
