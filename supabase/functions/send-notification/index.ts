/**
 * supabase/functions/send-notification/index.ts
 *
 * Edge Function для отправки уведомления в Telegram-канал @conditera.
 * Вызывается через trigger на INSERT в orders/leads/tickets.
 *
 * Использование через pg_cron:
 *   SELECT cron.schedule('send-channel-notification',
 *     '* * * * *',
 *     $$SELECT net.http_post(
 *       url:='http://supabase-kong:8000/functions/v1/send-notification',
 *       headers:='{"Content-Type":"application/json"}'::jsonb,
 *       body:='{"type":"order_created","orderId":"ORD-2026-0042","amount":4500,"customer":"Maria S."}'::jsonb
 *     )$$);
 */

interface NotificationPayload {
  type: "order_created" | "lead_new" | "ticket_created" | "payout_request" | "fraud_alert";
  orderId?: string;
  leadId?: string;
  ticketId?: string;
  payoutId?: string;
  amount?: number;
  customer?: string;
  confectioner?: string;
  priority?: "low" | "medium" | "high" | "urgent";
}

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHANNEL_ID = Deno.env.get("TELEGRAM_CHANNEL_ID") ?? "@conditera";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

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
    const payload: NotificationPayload = await req.json();
    const message = formatMessage(payload);

    await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHANNEL_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Send notification error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

function formatMessage(payload: NotificationPayload): string {
  const emoji = {
    order_created: "🛒",
    lead_new: "📊",
    ticket_created: "🎫",
    payout_request: "💰",
    fraud_alert: "⚠️",
  }[payload.type] || "📢";

  const titles = {
    order_created: "Новый заказ",
    lead_new: "Новый лид",
    ticket_created: "Новый тикет",
    payout_request: "Запрос выплаты",
    fraud_alert: "⚠️ Фрод-алерт",
  };

  let msg = `${emoji} <b>${titles[payload.type]}</b>\n\n`;

  if (payload.orderId) msg += `📦 Заказ: <code>${payload.orderId}</code>\n`;
  if (payload.leadId) msg += `📊 Лид: <code>${payload.leadId}</code>\n`;
  if (payload.ticketId) msg += `🎫 Тикет: <code>${payload.ticketId}</code>\n`;
  if (payload.payoutId) msg += `💰 Выплата: <code>${payload.payoutId}</code>\n`;
  if (payload.amount) msg += `💵 Сумма: <b>${payload.amount.toLocaleString()} ₽</b>\n`;
  if (payload.customer) msg += `👤 Клиент: ${payload.customer}\n`;
  if (payload.confectioner) msg += `👨‍🍳 Кондитер: ${payload.confectioner}\n`;
  if (payload.priority) {
    const priorityEmoji = { low: "🟢", medium: "🟡", high: "🟠", urgent: "🔴" }[payload.priority] || "⚪";
    msg += `${priorityEmoji} Приоритет: <b>${payload.priority.toUpperCase()}</b>\n`;
  }

  msg += `\n📅 ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`;

  return msg;
}
