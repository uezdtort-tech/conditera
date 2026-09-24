/**
 * POST /api/chat/auto-reply — обработка входящего сообщения от пользователя.
 *
 * Flow:
 *  1. Получаем сообщение пользователя
 *  2. Ищем совпадение в FAQ_TOPICS
 *  3. Если найдено — отправляем авто-ответ с quick replies
 *  4. Если не найдено — отправляем UNKNOWN_QUERY_MESSAGE + DEFAULT_QUICK_REPLIES
 *  5. Если user триггерит "human:operator" — эскалируем
 *
 * Auth: пользователь должен быть участником комнаты
 *
 * Безопасность:
 *   • POST: requires AUTHENTICATED.
 *   • Ownership check: user должен быть в room.participants.
 *   • safeJsonBody + валидация roomId/message.
 *   • При сбое DB операций — продолжаем, не блокируем (escalation/faq могут не сработать, но bot message отправится).
 *   • Type-safe interfaces для всех данных.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { matchFaqMl } from "@/lib/chat-faq-ml";
import { sendBotMessage } from "@/lib/chat-automation";
import { FAQ_TOPICS_EN, detectLanguage, getLocalizedStrings } from "@/lib/chat-faq-en";
import { analyzeSentimentHybrid } from "@/lib/sentiment-v2";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface ChatRoomRow {
  id: string;
  participants: string[] | null;
  order_id: string | null;
}

interface ChatMessageRow {
  id: string;
}

interface UserRow {
  id: string;
  name: string | null;
}

interface AutoReplyBody {
  roomId?: string;
  message?: string;
}

const MAX_MESSAGE_LENGTH = 5000;
const RECENT_BOT_MESSAGES_LIMIT = 5;
const UNKNOWN_THRESHOLD = 3;
const TEN_MINUTES_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseErr } = await safeJsonBody<AutoReplyBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    if (typeof body.roomId !== "string" || body.roomId.length === 0) {
      throw new HttpError(400, "Не указан roomId");
    }
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      throw new HttpError(400, "Не указан message");
    }
    if (body.message.length > MAX_MESSAGE_LENGTH) {
      throw new HttpError(422, `message слишком длинный (макс ${MAX_MESSAGE_LENGTH} символов)`);
    }

    const roomId = body.roomId;
    const message = body.message;

    // Проверяем, что user — участник комнаты
    const { data: room, error: roomErr } = await supabaseAdmin
      .from("chat_rooms")
      .select("id, participants, order_id")
      .eq("id", roomId)
      .maybeSingle() as { data: ChatRoomRow | null; error: SupabaseError | null };

    if (roomErr) {
      console.error("[auto-reply] room lookup failed:", roomErr.message);
      throw new HttpError(500, "Не удалось загрузить чат");
    }
    if (!room) {
      throw new HttpError(404, "Чат не найден");
    }
    const participants = room.participants || [];
    if (!participants.includes(user.userId)) {
      throw new HttpError(403, "Нет доступа к чату");
    }

    // Сохраняем сообщение пользователя
    const { data: userMessage, error: msgErr } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        room_id: roomId,
        sender_id: user.userId,
        text: message,
        is_system: false,
        is_bot: false,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single() as { data: ChatMessageRow | null; error: SupabaseError | null };

    if (msgErr || !userMessage) {
      console.error("[auto-reply] user message insert failed:", msgErr?.message);
      throw new HttpError(500, "Не удалось сохранить сообщение");
    }

    // Обновляем lastMessage в комнате
    const { error: updateErr } = await supabaseAdmin
      .from("chat_rooms")
      .update({
        last_message: message,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", roomId);

    if (updateErr) {
      console.warn("[auto-reply] room update failed:", updateErr.message);
    }

    // Detect language (RU/EN) — отвечаем на языке пользователя
    const lang = detectLanguage(message);
    const l10n = getLocalizedStrings(lang);

    // Если это команда "operator" — эскалируем
    const escalationRegex = lang === "en"
      ? /^(operator|support|human|agent|help)\b/i
      : /^(оператор|поддержк|человек|operator|support|human)\b/i;
    if (escalationRegex.test(message.trim())) {
      // Создаём эскалацию для операторского дашборда
      try {
        const { data: userRow } = await supabaseAdmin
          .from("profiles")
          .select("name")
          .eq("id", user.userId)
          .maybeSingle() as { data: UserRow | null; error: SupabaseError | null };

        await supabaseAdmin
          .from("operator_escalations")
          .insert({
            room_id: roomId,
            user_id: user.userId,
            user_name: userRow?.name || "Пользователь",
            reason: "manual_request",
            message: message.slice(0, 1000),
            status: "pending",
            created_at: new Date().toISOString(),
          });
        console.info(`[auto-reply] Escalation created for room ${roomId}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[auto-reply] Failed to create escalation:", msg);
      }

      await sendBotMessage({
        roomId,
        text: l10n.escalation,
        botKind: "escalation",
        quickReplies: lang === "en"
          ? [
              { label: "Help section", action: "navigate:help" },
              { label: "FAQ", action: "navigate:faq" },
            ]
          : [
              { label: "Раздел помощи", action: "navigate:help" },
              { label: "FAQ", action: "navigate:faq" },
            ],
      });
      return NextResponse.json({ handled: "escalation", lang, userMessage });
    }

    // Sentiment analysis v2 (embeddings если @xenova/transformers установлен,
    // иначе fallback на v1 лексический). Детект негатива → авто-эскалация как "complaint"
    const sentiment = await analyzeSentimentHybrid(message);
    if (sentiment?.shouldEscalate) {
      try {
        const { data: userRow } = await supabaseAdmin
          .from("profiles")
          .select("name")
          .eq("id", user.userId)
          .maybeSingle() as { data: UserRow | null; error: SupabaseError | null };

        await supabaseAdmin
          .from("operator_escalations")
          .insert({
            room_id: roomId,
            user_id: user.userId,
            user_name: userRow?.name || "Пользователь",
            reason: "complaint",
            message: `[Sentiment: ${sentiment.label}, score ${sentiment.score.toFixed(2)}] ${message.slice(0, 800)}`,
            status: "pending",
            created_at: new Date().toISOString(),
          });
        console.info(`[auto-reply] Auto-escalation (complaint, score=${sentiment.score.toFixed(2)}) for room ${roomId}`);

        await sendBotMessage({
          roomId,
          text:
            lang === "en"
              ? "😟 I sense you're upset. I've connected you with a support operator who will help resolve this issue."
              : "😟 Вижу, что вы недовольны. Я передал ваш запрос оператору — он поможет решить проблему.",
          botKind: "escalation",
          quickReplies: l10n.defaultQuickReplies,
          metadata: {
            lang,
            autoEscalated: true,
            sentimentScore: sentiment.score,
            sentimentLabel: sentiment.label,
            triggers: sentiment.triggers,
          },
        });
        return NextResponse.json({
          handled: "auto_escalated",
          reason: "complaint",
          sentimentScore: sentiment.score,
          userMessage,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[auto-reply] Sentiment escalation failed:", msg);
      }
    }

    // ML-matcher: для русского используем chat-faq-ml, для английского — простой keyword-match
    if (lang === "en") {
      // English: linear keyword search
      const lower = message.toLowerCase();
      let bestEn: { topic: (typeof FAQ_TOPICS_EN)[number]; score: number } | null = null;
      for (const topic of FAQ_TOPICS_EN) {
        let score = 0;
        for (const kw of topic.keywords) {
          if (lower.includes(kw)) score += kw.length > 5 ? 2 : 1;
        }
        if (score > 0 && (!bestEn || score > bestEn.score)) {
          bestEn = { topic, score };
        }
      }
      if (bestEn) {
        await sendBotMessage({
          roomId,
          text: bestEn.topic.answer,
          botKind: "faq",
          quickReplies: bestEn.topic.quickReplies,
          metadata: { faqTopic: bestEn.topic.id, lang: "en", matchScore: bestEn.score },
        });
        return NextResponse.json({
          handled: "faq",
          topic: bestEn.topic.id,
          lang: "en",
          userMessage,
        });
      }
    } else {
      // Russian: ML-matcher
      const mlResult = matchFaqMl(message);
      if (mlResult) {
        await sendBotMessage({
          roomId,
          text: mlResult.topic.answer,
          botKind: "faq",
          quickReplies: mlResult.topic.quickReplies,
          metadata: {
            faqTopic: mlResult.topic.id,
            matchScore: mlResult.score,
            matchMethod: mlResult.method,
            lang: "ru",
          },
        });
        return NextResponse.json({
          handled: "faq",
          topic: mlResult.topic.id,
          lang: "ru",
          score: mlResult.score,
          method: mlResult.method,
          userMessage,
        });
      }
    }

    // Нет матча — unknown (локализованное сообщение).
    // Авто-эскалация: если 3+ подряд unknown от одного пользователя за 10 минут —
    // создаём эскалацию с reason="bot_unknown".
    let consecutiveUnknown = 0;
    try {
      const tenMinAgoIso = new Date(Date.now() - TEN_MINUTES_MS).toISOString();
      const { data: recentBotMessages } = await supabaseAdmin
        .from("chat_messages")
        .select("metadata")
        .eq("room_id", roomId)
        .eq("is_bot", true)
        .eq("bot_kind", "faq")
        .gte("created_at", tenMinAgoIso)
        .order("created_at", { ascending: false })
        .limit(RECENT_BOT_MESSAGES_LIMIT) as { data: Array<{ metadata: unknown }> | null; error: SupabaseError | null };

      // Если у bot-сообщения нет faqTopic в metadata — это "unknown"
      for (const m of recentBotMessages || []) {
        const meta = (m.metadata || {}) as Record<string, unknown>;
        if (!meta.faqTopic) {
          consecutiveUnknown++;
        } else {
          break;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[auto-reply] Failed to count unknown:", msg);
    }

    const shouldAutoEscalate = consecutiveUnknown >= UNKNOWN_THRESHOLD;
    if (shouldAutoEscalate) {
      try {
        const { data: userRow } = await supabaseAdmin
          .from("profiles")
          .select("name")
          .eq("id", user.userId)
          .maybeSingle() as { data: UserRow | null; error: SupabaseError | null };

        await supabaseAdmin
          .from("operator_escalations")
          .insert({
            room_id: roomId,
            user_id: user.userId,
            user_name: userRow?.name || "Пользователь",
            reason: "bot_unknown",
            message: `Бот не смог ответить ${consecutiveUnknown} раза подряд. Последнее: ${message.slice(0, 500)}`,
            status: "pending",
            created_at: new Date().toISOString(),
          });
        console.info(`[auto-reply] Auto-escalation (bot_unknown) for room ${roomId}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[auto-reply] Failed to create auto-escalation:", msg);
      }
    }

    await sendBotMessage({
      roomId,
      text: shouldAutoEscalate
        ? (lang === "en"
            ? "👨‍💼 I see I can't help with this. I've escalated to a human operator — they'll join shortly."
            : "👨‍💼 Вижу, что не могу вам помочь. Я передал запрос оператору — он подключится в ближайшее время.")
        : l10n.unknown,
      botKind: shouldAutoEscalate ? "escalation" : "faq",
      quickReplies: l10n.defaultQuickReplies,
      metadata: { lang, autoEscalated: shouldAutoEscalate },
    });

    return NextResponse.json({
      handled: shouldAutoEscalate ? "auto_escalated" : "unknown",
      lang,
      consecutiveUnknown,
      userMessage,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
