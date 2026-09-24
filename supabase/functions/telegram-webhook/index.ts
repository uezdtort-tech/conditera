/**
 * supabase/functions/telegram-webhook/index.ts
 *
 * Edge Function для приёма webhook от Telegram Bot API.
 * Запускается при получении сообщения или callback_query.
 *
 * Документация: https://developers.cloudflare.com/workers/examples/respond-to-webhooks
 *
 * Запуск через pg_cron (каждую минуту, проверяет очередь):
 *   SELECT cron.schedule('telegram-webhook-processor', '* * * * *',
 *     $$SELECT net.http_post(
 *       url:='http://supabase-kong:8000/functions/v1/telegram-webhook',
 *       headers:='{"Content-Type":"application/json"}'::jsonb,
 *       body:='{}'::jsonb
 *     )$$);
 *
 * ВАЖНО: в config.toml этого Edge Function verify_jwt = false (Telegram webhook не имеет JWT)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const update: TelegramUpdate = await req.json();

    // Если это сообщение от пользователя
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      // Обработка команд
      if (text === "/start") {
        await sendTelegramMessage(chatId, "👋 Добро пожаловать в «Уездный кондитер»!");
      } else if (text === "/help") {
        await sendTelegramMessage(
          chatId,
          "📋 Доступные команды:\n/start — начать\n/help — помощь\n/status — статус заказа"
        );
      } else if (text === "/status") {
        await sendTelegramMessage(chatId, "📦 У вас нет активных заказов.");
      } else {
        await sendTelegramMessage(
          chatId,
          "Понял! Ваше сообщение передано в поддержку. Ожидайте ответа в течение 24 часов."
        );
      }
    }

    // Если это callback_query (нажатие inline кнопки)
    if (update.callback_query) {
      await answerCallbackQuery(update.callback_query.id, "✓ Обработано");
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
}

async function answerCallbackQuery(callbackId: string, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackId,
      text,
    }),
  });
}
