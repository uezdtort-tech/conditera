/**
 * Internal Edge Function for operational Telegram channel notifications.
 * Access is restricted by Kong key-auth + service_role ACL.
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function formatMessage(payload: NotificationPayload): string {
  const definitions = {
    order_created: { emoji: "🛒", title: "Новый заказ" },
    lead_new: { emoji: "📊", title: "Новый лид" },
    ticket_created: { emoji: "🎫", title: "Новый тикет" },
    payout_request: { emoji: "💰", title: "Запрос выплаты" },
    fraud_alert: { emoji: "⚠️", title: "Фрод-алерт" },
  } as const;
  const definition = definitions[payload.type];
  if (!definition) throw new Error("Unsupported notification type");

  const lines = [`${definition.emoji} <b>${definition.title}</b>`, ""];
  if (payload.orderId) lines.push(`📦 Заказ: <code>${escapeHtml(payload.orderId)}</code>`);
  if (payload.leadId) lines.push(`📊 Лид: <code>${escapeHtml(payload.leadId)}</code>`);
  if (payload.ticketId) lines.push(`🎫 Тикет: <code>${escapeHtml(payload.ticketId)}</code>`);
  if (payload.payoutId) lines.push(`💰 Выплата: <code>${escapeHtml(payload.payoutId)}</code>`);
  if (typeof payload.amount === "number" && Number.isFinite(payload.amount) && payload.amount >= 0) {
    lines.push(`💵 Сумма: <b>${payload.amount.toLocaleString("ru-RU")} ₽</b>`);
  }
  if (payload.customer) lines.push(`👤 Клиент: ${escapeHtml(payload.customer.slice(0, 160))}`);
  if (payload.confectioner) lines.push(`👨‍🍳 Кондитер: ${escapeHtml(payload.confectioner.slice(0, 160))}`);
  if (payload.priority) {
    const priorityEmoji = { low: "🟢", medium: "🟡", high: "🟠", urgent: "🔴" }[payload.priority];
    if (priorityEmoji) lines.push(`${priorityEmoji} Приоритет: <b>${payload.priority.toUpperCase()}</b>`);
  }
  lines.push("", `📅 ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`);
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
    console.error("[send-notification] Telegram bot/channel is not configured");
    return Response.json({ error: "Telegram notification channel is not configured" }, { status: 503, headers: corsHeaders });
  }

  try {
    const payload = await req.json() as NotificationPayload;
    if (!payload || typeof payload !== "object" || !Object.hasOwn(payload, "type")) {
      return Response.json({ error: "Invalid notification payload" }, { status: 400, headers: corsHeaders });
    }
    const message = formatMessage(payload);
    const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHANNEL_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (!response.ok || result?.ok !== true) {
      console.error("[send-notification] Telegram API rejected message:", result?.description || response.status);
      return Response.json({ error: "Telegram delivery failed" }, { status: 502, headers: corsHeaders });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("[send-notification] Failed:", error);
    return Response.json({ error: "Notification processing failed" }, { status: 500, headers: corsHeaders });
  }
});
