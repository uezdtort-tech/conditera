/**
 * Telegram Bot API webhook.
 * Kong exposes this route without key-auth; every request is authenticated
 * with the secret_token configured through Telegram setWebhook.
 */

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

interface TelegramUpdate {
  update_id: number;
  message?: {
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    data?: string;
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-telegram-bot-api-secret-token",
};

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length === 0 || b.length === 0) return false;
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function telegramRequest(method: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${TELEGRAM_API_URL}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || result?.ok !== true) {
    throw new Error(`Telegram API ${method} failed: ${result?.description || response.status}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }
  if (!TELEGRAM_WEBHOOK_SECRET) {
    console.error("[telegram-webhook] TELEGRAM_WEBHOOK_SECRET is not configured");
    return Response.json({ error: "Webhook is not configured" }, { status: 503, headers: corsHeaders });
  }
  const suppliedSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!constantTimeEqual(suppliedSecret, TELEGRAM_WEBHOOK_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("[telegram-webhook] TELEGRAM_BOT_TOKEN is not configured");
    return Response.json({ error: "Bot is not configured" }, { status: 503, headers: corsHeaders });
  }

  try {
    const update = await req.json() as TelegramUpdate;
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) {
      return Response.json({ error: "Invalid Telegram update" }, { status: 400, headers: corsHeaders });
    }

    if (update.message?.text && Number.isSafeInteger(update.message.chat?.id)) {
      const chatId = update.message.chat.id;
      const command = update.message.text.trim().split(/\s+/, 1)[0].split("@", 1)[0];
      if (command === "/start") {
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: "Добро пожаловать в Conditera! Здесь можно получить справочную информацию о платформе.",
        });
      } else if (command === "/help") {
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: "Доступные команды:\n/start — приветствие\n/help — помощь\n/status — где посмотреть заказы",
        });
      } else if (command === "/status") {
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: "Статус и история заказов доступны в личном кабинете Conditera в разделе «Мои заказы».",
        });
      } else {
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: "Команда не распознана. Используйте /start или /help.",
        });
      }
    }

    if (update.callback_query?.id) {
      await telegramRequest("answerCallbackQuery", {
        callback_query_id: update.callback_query.id,
        text: "Принято",
      });
    }

    return Response.json({ ok: true, updateId: update.update_id }, { headers: corsHeaders });
  } catch (error) {
    console.error("[telegram-webhook] request failed:", error);
    return Response.json({ error: "Webhook processing failed" }, { status: 500, headers: corsHeaders });
  }
});
