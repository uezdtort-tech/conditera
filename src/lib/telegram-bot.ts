/**
 * Telegram Bot — отправка уведомлений в Telegram-канал и бот.
 *
 * Возможности:
 *  1. Уведомления в канал (@conditera_alerts) — новые заказы, лиды, тикеты, ошибки
 *  2. Бот для клиентов — команды /start, /help, /orders, /support, /track
 *  3. Бот для админов — /stats, /broadcast, /health
 *
 * Настройка:
 *  1. Создать бота через @BotFather → получить TELEGRAM_BOT_TOKEN
 *  2. Создать канал → добавить бота администратором → TELEGRAM_CHANNEL_ID (например @conditera_alerts)
 *  3. Установить webhook: https://conditera.ru/api/telegram/webhook
 *
 * Документация: https://core.telegram.org/bots/api
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID  // @conditera_alerts или -1001234567890
const API_BASE = "https://api.telegram.org/bot"

// ===== Types =====
export interface TelegramMessage {
  chatId: string | number
  text: string
  parseMode?: "HTML" | "Markdown" | "MarkdownV2"
  disableNotification?: boolean
  replyMarkup?: any
}

export interface TelegramNotification {
  type: "order" | "lead" | "ticket" | "payment" | "error" | "info" | "warning" | "confectioner"
  title: string
  body: string
  url?: string
}

// ===== Core: send message =====

/**
 * Отправить сообщение в Telegram через Bot API.
 */
export async function sendTelegramMessage(
  msg: TelegramMessage
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  if (!BOT_TOKEN) {
    console.warn("[telegram] BOT_TOKEN not set — message not sent")
    return { success: false, error: "Bot token not configured" }
  }

  try {
    const response = await fetch(`${API_BASE}/${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: msg.chatId,
        text: msg.text,
        parse_mode: msg.parseMode || "HTML",
        disable_notification: msg.disableNotification || false,
        reply_markup: msg.replyMarkup,
        disable_web_page_preview: true,
      }),
    })

    const data = await response.json()

    if (!data.ok) {
      console.error("[telegram] Send failed:", data.description)
      return { success: false, error: data.description }
    }

    return { success: true, messageId: data.result?.message_id }
  } catch (err) {
    console.error("[telegram] Send error:", err)
    return { success: false, error: String(err) }
  }
}

/**
 * Отправить уведомление в Telegram-канал.
 * Канал должен быть указан в TELEGRAM_CHANNEL_ID.
 */
export async function sendToChannel(
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<boolean> {
  if (!CHANNEL_ID) {
    console.warn("[telegram] CHANNEL_ID not set — notification not sent")
    return false
  }

  const result = await sendTelegramMessage({
    chatId: CHANNEL_ID,
    text,
    parseMode,
  })
  return result.success
}

// ===== Notification helpers (с красивым форматированием) =====

const EMOJI: Record<TelegramNotification["type"], string> = {
  order: "🛒",
  lead: "📞",
  ticket: "🎫",
  payment: "💳",
  error: "❌",
  info: "ℹ️",
  warning: "⚠️",
  confectioner: "🎂",
}

/**
 * Отправить структурированное уведомление в канал.
 */
export async function notifyChannel(
  notification: TelegramNotification
): Promise<boolean> {
  const emoji = EMOJI[notification.type]
  const urlLine = notification.url ? `\n\n🔗 <a href="${notification.url}">Открыть</a>` : ""

  const text = `${emoji} <b>${notification.title}</b>\n\n${notification.body}${urlLine}`

  return sendToChannel(text)
}

/**
 * Уведомление о новом заказе.
 */
export async function notifyNewOrder(params: {
  orderNumber: string
  customerName: string
  total: number
  items: { title: string; quantity: number; price: number }[]
  confectionerName?: string
  paymentMethod?: string
  deliveryDate?: string
}): Promise<boolean> {
  const itemsText = params.items
    .map((i) => `  • ${i.title} ×${i.quantity} — ${i.price} ₽`)
    .join("\n")

  return notifyChannel({
    type: "order",
    title: `Новый заказ ${params.orderNumber}`,
    body: [
      `<b>Клиент:</b> ${params.customerName}`,
      `<b>Сумма:</b> ${params.total.toLocaleString("ru-RU")} ₽`,
      params.confectionerName ? `<b>Кондитер:</b> ${params.confectionerName}` : "",
      params.paymentMethod ? `<b>Оплата:</b> ${params.paymentMethod}` : "",
      params.deliveryDate ? `<b>Доставка:</b> ${params.deliveryDate}` : "",
      "",
      "<b>Состав:</b>",
      itemsText,
    ].filter(Boolean).join("\n"),
  })
}

/**
 * Уведомление о новом лиде.
 */
export async function notifyNewLead(params: {
  leadId: string
  name: string
  email?: string
  phone?: string
  company?: string
  source: string
  need?: string
  budget?: number
}): Promise<boolean> {
  return notifyChannel({
    type: "lead",
    title: "Новый лид",
    body: [
      `<b>Имя:</b> ${params.name}`,
      params.company ? `<b>Компания:</b> ${params.company}` : "",
      params.email ? `<b>Email:</b> ${params.email}` : "",
      params.phone ? `<b>Телефон:</b> ${params.phone}` : "",
      `<b>Источник:</b> ${params.source}`,
      params.budget ? `<b>Бюджет:</b> ${params.budget.toLocaleString("ru-RU")} ₽` : "",
      params.need ? `<b>Потребность:</b> ${params.need}` : "",
    ].filter(Boolean).join("\n"),
    url: "https://conditera.ru/dashboard?tab=crm-leads",
  })
}

/**
 * Уведомление о новом тикете поддержки.
 */
export async function notifyNewTicket(params: {
  ticketNumber: string
  customerName: string
  subject: string
  priority: string
  category?: string
  orderNumber?: string
}): Promise<boolean> {
  const priorityEmoji: Record<string, string> = {
    low: "🟢",
    medium: "🟡",
    high: "🔴",
    urgent: "🚨",
  }

  return notifyChannel({
    type: "ticket",
    title: `${priorityEmoji[params.priority] || "🎫"} Новый тикет ${params.ticketNumber}`,
    body: [
      `<b>Клиент:</b> ${params.customerName}`,
      `<b>Тема:</b> ${params.subject}`,
      `<b>Приоритет:</b> ${params.priority}`,
      params.category ? `<b>Категория:</b> ${params.category}` : "",
      params.orderNumber ? `<b>Заказ:</b> ${params.orderNumber}` : "",
    ].filter(Boolean).join("\n"),
    url: "https://conditera.ru/dashboard?tab=crm-tickets",
  })
}

/**
 * Уведомление об успешной оплате.
 */
export async function notifyPaymentSucceeded(params: {
  orderNumber: string
  amount: number
  customerName: string
  paymentMethod: string
}): Promise<boolean> {
  return notifyChannel({
    type: "payment",
    title: `Оплата получена — ${params.orderNumber}`,
    body: [
      `<b>Сумма:</b> ${params.amount.toLocaleString("ru-RU")} ₽`,
      `<b>Клиент:</b> ${params.customerName}`,
      `<b>Метод:</b> ${params.paymentMethod}`,
    ].join("\n"),
  })
}

/**
 * Уведомление о новой/повторной заявке кондитера на модерацию.
 *
 * Используется в:
 *   - /api/confectioner/resubmit (повторная отправка профиля)
 *   - регистрации новых кондитеров (если будет добавлен endpoint)
 *
 * Пример сообщения:
 *   🔔 Новая заявка кондитера
 *   📋 Бизнес: ООО «Сладкоежка»
 *   🏙️ Город: Москва
 *   📧 Email: ivan@example.com
 *   🆔 ID: conf_abc123
 *   🔄 Повторная заявка: да
 */
export async function notifyNewConfectionerPending(params: {
  confectionerId: string
  businessName: string
  city?: string
  email?: string
  isResubmit?: boolean
}): Promise<boolean> {
  const title = params.isResubmit
    ? `🔁 Повторная заявка кондитера — ${params.businessName}`
    : `🆕 Новая заявка кондитера — ${params.businessName}`;

  return notifyChannel({
    type: "confectioner",
    title,
    body: [
      `<b>📋 Бизнес:</b> ${params.businessName}`,
      params.city ? `<b>🏙️ Город:</b> ${params.city}` : "",
      params.email ? `<b>📧 Email:</b> ${params.email}` : "",
      `<b>🆔 ID:</b> <code>${params.confectionerId}</code>`,
      params.isResubmit ? `<b>🔄 Статус:</b> повторная заявка (после правок)` : `<b>🔄 Статус:</b> новая заявка`,
      "",
      "👉 <a href=\"https://conditera.ru/dashboard?view=dashboard-admin\">Открыть админ-панель</a>",
    ].filter(Boolean).join("\n"),
  });
}

/**
 * Уведомление об ошибке (для дежурного).
 */
export async function notifyError(params: {
  error: string
  context?: string
  stack?: string
  url?: string
}): Promise<boolean> {
  const body = [
    `<b>Ошибка:</b> <code>${params.error}</code>`,
    params.context ? `<b>Контекст:</b> ${params.context}` : "",
    params.url ? `<b>URL:</b> ${params.url}` : "",
    params.stack ? `\n<details><pre>${params.stack.slice(0, 1000)}</pre></details>` : "",
  ].filter(Boolean).join("\n")

  return notifyChannel({
    type: "error",
    title: "⚠️ Ошибка в приложении",
    body,
  })
}

// ===== Bot setup: webhook registration =====

/**
 * Зарегистрировать webhook для бота.
 * Вызывать при деплое (через /api/telegram/setup-webhook).
 *
 * @param webhookUrl — например https://conditera.ru/api/telegram/webhook
 */
export async function setWebhook(webhookUrl: string): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.warn("[telegram] BOT_TOKEN not set")
    return false
  }

  try {
    const response = await fetch(`${API_BASE}/${BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        max_connections: 40,
        allowed_updates: [
          "message",
          "callback_query",
          "inline_query",
          "chat_member",
        ],
      }),
    })

    const data = await response.json()
    if (data.ok) {
      console.info(`[telegram] Webhook set: ${webhookUrl}`)
      return true
    } else {
      console.error("[telegram] setWebhook failed:", data.description)
      return false
    }
  } catch (err) {
    console.error("[telegram] setWebhook error:", err)
    return false
  }
}

/**
 * Удалить webhook (переключиться на long polling — для dev).
 */
export async function deleteWebhook(): Promise<boolean> {
  if (!BOT_TOKEN) return false

  try {
    const response = await fetch(`${API_BASE}/${BOT_TOKEN}/deleteWebhook`, {
      method: "POST",
    })
    const data = await response.json()
    return data.ok
  } catch {
    return false
  }
}

/**
 * Получить информацию о боте (для проверки токена).
 */
export async function getBotInfo(): Promise<any> {
  if (!BOT_TOKEN) return null

  try {
    const response = await fetch(`${API_BASE}/${BOT_TOKEN}/getMe`)
    const data = await response.json()
    return data.ok ? data.result : null
  } catch {
    return null
  }
}

// ===== Bot commands =====

/**
 * Список команд бота (регистрируется через setMyCommands).
 */
export const BOT_COMMANDS = [
  { command: "start", description: "Начать работу с ботом" },
  { command: "help", description: "Помощь и список команд" },
  { command: "orders", description: "Мои заказы" },
  { command: "support", description: "Связаться с поддержкой" },
  { command: "track", description: "Отследить заказ по номеру" },
  { command: "catalog", description: "Открыть каталог" },
  { command: "contacts", description: "Контакты кондитеров" },
  // Админ-команды (видны только админам)
  { command: "stats", description: "[Админ] Статистика платформы" },
  { command: "broadcast", description: "[Админ] Рассылка в канал" },
  { command: "health", description: "[Админ] Статус сервисов" },
]

/**
 * Зарегистрировать команды бота в Telegram.
 */
export async function setBotCommands(): Promise<boolean> {
  if (!BOT_TOKEN) return false

  try {
    const response = await fetch(`${API_BASE}/${BOT_TOKEN}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    })
    const data = await response.json()
    return data.ok
  } catch {
    return false
  }
}
