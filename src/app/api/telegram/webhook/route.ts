/**
 * POST /api/telegram/webhook — приём обновлений от Telegram Bot API.
 * Telegram отправляет сюда сообщения, callback_query, inline_query.
 *
 * Безопасность:
 *   • Telegram webhook всегда возвращает 200 OK (иначе ретраи).
 *   • Команды /stats, /health, /broadcast — только для админов (TELEGRAM_ADMIN_CHAT_IDS).
 *   • /track — публичный поиск заказа по номеру.
 *   • Type-safe interfaces для всех Telegram update types.
 *   • При любой ошибке — возвращаем 200 OK (не блокируем Telegram).
 */
import { NextRequest, NextResponse } from "next/server";
import { sendTelegramMessage, BOT_COMMANDS } from "@/lib/telegram-bot";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

interface TgChat {
  id: number;
  type: string;
}

interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  date?: number;
}

interface TgCallbackQuery {
  id: string;
  data?: string;
  message?: TgMessage;
  from?: TgUser;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  inline_query?: unknown;
}

interface OrderRow {
  number: string;
  status: string;
  total: number;
  payment_status: string;
  delivery_date: string | null;
  confectioner_name: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "⏳ Ожидает подтверждения",
  CONFIRMED: "✅ Подтверждён",
  IN_PROGRESS: "🎂 Готовится",
  READY: "🎉 Готов к выдаче",
  DELIVERING: "🚚 В доставке",
  COMPLETED: "✅ Завершён",
  CANCELLED: "❌ Отменён",
  DISPUTE: "⚠️ Спор",
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://conditera.ru";

/**
 * Проверить, является ли chatId админским.
 */
function isAdminChat(chatId: number): boolean {
  const adminIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS || "").split(",").filter(Boolean);
  return adminIds.includes(String(chatId));
}

/**
 * Обработка входящего сообщения от пользователя боту.
 */
async function handleMessage(message: TgMessage): Promise<void> {
  const chatId = message.chat.id;
  const text = message.text || "";
  const fromUser = message.from;
  const username = fromUser?.username ? `@${fromUser.username}` : fromUser?.first_name || "Гость";

  // Команды (начинаются с /)
  if (text.startsWith("/")) {
    const [command, ...args] = text.slice(1).split(" ");
    await handleCommand(chatId, command.toLowerCase(), args.join(" "), username, fromUser);
    return;
  }

  // Обычное сообщение — показываем помощь
  await sendTelegramMessage({
    chatId,
    text: `Здравствуйте, ${username}! 👋\n\nЯ бот «Уездного кондитера». Введите /help чтобы увидеть список команд.`,
    parseMode: "HTML",
  });
}

/**
 * Обработка команд бота.
 */
async function handleCommand(
  chatId: number,
  command: string,
  args: string,
  username: string,
  _fromUser?: TgUser
): Promise<void> {
  switch (command) {
    case "start":
      await sendTelegramMessage({
        chatId,
        text: [
          `🍰 Добро пожаловать в «Уездный кондитер», ${username}!`,
          "",
          "Я помогу вам с заказами тортов и десертов.",
          "",
          "Доступные команды:",
          "/help — список всех команд",
          "/catalog — открыть каталог",
          "/orders — мои заказы",
          "/track <номер> — отследить заказ",
          "/support — связаться с поддержкой",
          "/contacts — контакты кондитеров",
          "",
          `🌐 Наш сайт: ${APP_URL}`,
        ].join("\n"),
      });
      break;

    case "help": {
      const helpText = BOT_COMMANDS
        .map((c) => `/${c.command} — ${c.description}`)
        .join("\n");
      await sendTelegramMessage({
        chatId,
        text: `📋 <b>Команды бота</b>\n\n${helpText}\n\n🌐 Сайт: ${APP_URL}`,
        parseMode: "HTML",
      });
      break;
    }

    case "catalog":
      await sendTelegramMessage({
        chatId,
        text: `🍰 <b>Каталог тортов и десертов</b>\n\nОткройте наш полный каталог на сайте:\n${APP_URL}/catalog\n\nТам вы найдете:\n• Торты на заказ\n• Капкейки и макаронс\n• Чизкейки и десерты\n• Конструктор торта`,
        parseMode: "HTML",
      });
      break;

    case "orders":
      await sendTelegramMessage({
        chatId,
        text: `📦 Для просмотра ваших заказов необходимо войти в аккаунт на сайте.\n\n${APP_URL}/dashboard\n\nПосле авторизации ваши заказы будут доступны здесь.`,
      });
      break;

    case "track":
      if (!args) {
        await sendTelegramMessage({
          chatId,
          text: "Использование: /track <номер заказа>\n\nПример: /track UK-2025-0234",
        });
        return;
      }
      // Поиск заказа по номеру
      try {
        const { data: order, error } = await supabaseAdmin
          .from("orders")
          .select("number, status, total, payment_status, delivery_date, confectioner_name")
          .ilike("number", args.toUpperCase())
          .maybeSingle() as { data: OrderRow | null; error: SupabaseError | null };

        if (error || !order) {
          await sendTelegramMessage({
            chatId,
            text: `❌ Заказ ${args} не найден.\n\nПроверьте номер заказа. Формат: UK-2025-XXXX`,
          });
          return;
        }

        await sendTelegramMessage({
          chatId,
          text: [
            `📦 <b>Заказ ${order.number}</b>`,
            "",
            `Статус: ${STATUS_LABELS[order.status] || order.status}`,
            `Сумма: ${order.total.toLocaleString("ru-RU")} ₽`,
            `Оплата: ${order.payment_status}`,
            order.confectioner_name ? `Кондитер: ${order.confectioner_name}` : "",
            order.delivery_date
              ? `Доставка: ${new Date(order.delivery_date).toLocaleDateString("ru-RU")}`
              : "",
            "",
            `Подробнее: ${APP_URL}/dashboard`,
          ]
            .filter(Boolean)
            .join("\n"),
          parseMode: "HTML",
        });
      } catch {
        await sendTelegramMessage({
          chatId,
          text: "❌ Не удалось найти заказ. Попробуйте позже.",
        });
      }
      break;

    case "support":
      await sendTelegramMessage({
        chatId,
        text: [
          "🛟 <b>Поддержка «Уездного кондитера»</b>",
          "",
          "Связаться с нами можно несколькими способами:",
          "",
          `💬 Чат на сайте: ${APP_URL} (виджет в правом нижнем углу)`,
          "📧 Email: support@conditera.ru",
          `🎫 Создать тикет: ${APP_URL}/dashboard?tab=crm-tickets`,
          "",
          "Время работы: ежедневно 10:00-22:00 (МСК)",
        ].join("\n"),
        parseMode: "HTML",
      });
      break;

    case "contacts":
      await sendTelegramMessage({
        chatId,
        text: [
          "📞 <b>Контакты</b>",
          "",
          `🌐 Сайт: ${APP_URL}`,
          "📧 Email: info@conditera.ru",
          "📱 Telegram: @conditera_support",
          "",
          "Найти кондитера в вашем городе:",
          `${APP_URL}/confectioners`,
        ].join("\n"),
        parseMode: "HTML",
      });
      break;

    case "stats":
      if (!isAdminChat(chatId)) {
        await sendTelegramMessage({
          chatId,
          text: "❌ Команда доступна только администраторам.",
        });
        return;
      }
      try {
        const [usersRes, ordersRes, productsRes, ticketsRes] = await Promise.all([
          supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
          supabaseAdmin.from("orders").select("*", { count: "exact", head: true }),
          supabaseAdmin.from("products").select("*", { count: "exact", head: true }),
          supabaseAdmin
            .from("support_tickets")
            .select("*", { count: "exact", head: true })
            .in("status", ["open", "in_progress"]),
        ]);

        await sendTelegramMessage({
          chatId,
          text: [
            "📊 <b>Статистика платформы</b>",
            "",
            `Пользователей: ${usersRes.count || 0}`,
            `Заказов: ${ordersRes.count || 0}`,
            `Товаров: ${productsRes.count || 0}`,
            `Открытых тикетов: ${ticketsRes.count || 0}`,
            "",
            `Время: ${new Date().toLocaleString("ru-RU")}`,
          ].join("\n"),
          parseMode: "HTML",
        });
      } catch {
        await sendTelegramMessage({
          chatId,
          text: "❌ Не удалось получить статистику.",
        });
      }
      break;

    case "health":
      if (!isAdminChat(chatId)) {
        await sendTelegramMessage({
          chatId,
          text: "❌ Команда доступна только администраторам.",
        });
        return;
      }
      {
        const services = [
          { name: "Web (Next.js)", url: `${APP_URL}/api/health` },
          { name: "Meilisearch", url: `${APP_URL}/api/search/health` },
        ];
        const results = await Promise.all(
          services.map(async (s) => {
            try {
              const res = await fetch(s.url, { signal: AbortSignal.timeout(5000) });
              return `${res.ok ? "✅" : "❌"} ${s.name}: ${res.status}`;
            } catch {
              return `❌ ${s.name}: недоступен`;
            }
          })
        );
        await sendTelegramMessage({
          chatId,
          text: `🏥 <b>Статус сервисов</b>\n\n${results.join("\n")}`,
          parseMode: "HTML",
        });
      }
      break;

    case "broadcast":
      if (!isAdminChat(chatId)) {
        await sendTelegramMessage({
          chatId,
          text: "❌ Команда доступна только администраторам.",
        });
        return;
      }
      if (!args) {
        await sendTelegramMessage({
          chatId,
          text: "Использование: /broadcast <текст сообщения>",
        });
        return;
      }
      {
        const { sendToChannel } = await import("@/lib/telegram-bot");
        const sent = await sendToChannel(args);
        await sendTelegramMessage({
          chatId,
          text: sent ? "✅ Сообщение отправлено в канал." : "❌ Ошибка отправки.",
        });
      }
      break;

    default:
      await sendTelegramMessage({
        chatId,
        text: `Неизвестная команда: /${command}\n\nВведите /help для списка команд.`,
      });
  }
}

/**
 * Обработка callback_query (inline кнопки).
 */
async function handleCallbackQuery(callbackQuery: TgCallbackQuery): Promise<void> {
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data;

  if (!chatId) return;

  await sendTelegramMessage({
    chatId,
    text: `Вы нажали: ${data || "—"}`,
  });
}

// ===== Webhook handler =====
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const update = (await request.json().catch(() => null)) as TgUpdate | null;
    if (!update) {
      return NextResponse.json({ ok: true });
    }

    // Обработка сообщения
    if (update.message) {
      await handleMessage(update.message);
    }
    // Обработка callback_query (inline кнопки)
    else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }

    // Telegram ожидает 200 OK
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("POST /api/telegram/webhook error:", msg);
    // Всё равно возвращаем 200 — иначе Telegram будет ретраить
    return NextResponse.json({ ok: true });
  }
}

// GET — для проверки что webhook жив
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: "ok",
    service: "telegram-webhook",
    timestamp: new Date().toISOString(),
  });
}
