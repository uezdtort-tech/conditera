/**
 * Автоматизация чата: приём и сопровождение заказа.
 *
 * Архитектура:
 *  - System user "Uezdny Assistant" (isBot=true, botRole="order_assistant")
 *  - При создании заказа → создаётся ChatRoom, привязанный к orderId
 *  - При смене статуса заказа → auto-сообщение в чат (isBot=true, botKind="order_status")
 *  - FAQ-бот: распознаёт ключевые слова и отвечает автоматически
 *  - Quick replies: кнопки быстрых ответов для покупателя
 *  - Эскалация: если бот не понимает → приглашает оператора
 *
 * Триггеры:
 *  - order.created → welcome message + quick replies
 *  - order.confirmed → "Кондитер принял заказ"
 *  - order.in_progress → "Кондитер начал готовку"
 *  - order.ready → "Заказ готов, ожидает доставку"
 *  - order.delivering → "Курьер в пути"
 *  - order.completed → "Заказ завершён, оставьте отзыв"
 *  - order.cancelled → "Заказ отменён, возврат средств"
 *  - order.dispute → "Открыт спор, ждите решения"
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin.
 *   • ensureOrderChatRoom идемпотентен — если комната уже есть, возвращает её.
 *   • Все ошибки логируются, не бросают исключения —
 *     сбой чат-бота не должен блокировать смену статуса заказа.
 */

import { supabaseAdmin } from "./supabase/admin";
import { ensureOrderChatChannel, BOT_USER_ID } from "./chat-rooms";

// ===== System bot user =====
const BOT_EMAIL = "assistant@conditera.bot";
const BOT_NAME = "Уездный помощник";
const BOT_AVATAR = "/logo.png";

interface SupabaseError {
  message: string;
}

interface UserRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}

interface OrderRow {
  id: string;
  number: string;
  total: number;
  delivery_address: string | null;
  delivery_date: string | null;
  delivery_time: string | null;
  customer_id: string;
  confectioner_id: string | null;
}

interface OrderItemForChat {
  title: string;
  quantity: number;
  price: number;
}

/**
 * Получить (или создать) системного пользователя-бота.
 * Используется как senderId для всех auto-сообщений.
 */
export async function getBotUser(): Promise<{ id: string; name: string; avatar: string }> {
  // Try to find existing bot user
  const { data: bot, error: findErr } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url, email")
    .eq("email", BOT_EMAIL)
    .maybeSingle() as { data: UserRow | null; error: SupabaseError | null };

  if (findErr) {
    console.error("[chat-bot] lookup failed:", findErr.message);
    throw new Error(`Не удалось загрузить бота: ${findErr.message}`);
  }

  if (bot) {
    return {
      id: bot.id,
      name: bot.name || BOT_NAME,
      avatar: bot.avatar_url || BOT_AVATAR,
    };
  }

  // p1-b: фолбэк на сид-бота локального runtime (compat/0004_seed_bot_user,
  // support-bot@system.local — тот же BOT_USER_ID, что и у нового чата).
  // Прежняя попытка создать профиль на лету ломалась ограничением
  // profiles_id_fkey (profiles.id → users.id) и молча роняла ВСЕ bot-сообщения.
  const { data: seededBot } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url")
    .eq("id", BOT_USER_ID)
    .maybeSingle() as { data: UserRow | null; error: SupabaseError | null };

  if (seededBot) {
    return {
      id: seededBot.id,
      name: seededBot.name || BOT_NAME,
      avatar: seededBot.avatar_url || BOT_AVATAR,
    };
  }

  // Create bot user
  const { data: newBot, error: createErr } = await supabaseAdmin
    .from("profiles")
    .insert({
      email: BOT_EMAIL,
      password_hash: `bot-no-login-${Math.random().toString(36)}`,
      name: BOT_NAME,
      avatar_url: BOT_AVATAR,
      is_bot: true,
      bot_role: "order_assistant",
      created_at: new Date().toISOString(),
    })
    .select("id, name, avatar_url")
    .single() as { data: { id: string; name: string | null; avatar_url: string | null } | null; error: SupabaseError | null };

  if (createErr || !newBot) {
    console.error("[chat-bot] create failed:", createErr?.message);
    throw new Error("Не удалось создать системного бота");
  }

  // Создаем роль CUSTOMER для бота
  await supabaseAdmin
    .from("user_roles")
    .insert({
      user_id: newBot.id,
      role: "CUSTOMER",
      is_active: true,
      assigned_at: new Date().toISOString(),
    });

  console.info(`[chat-bot] Created system bot user: ${newBot.id}`);
  return {
    id: newBot.id,
    name: newBot.name || BOT_NAME,
    avatar: newBot.avatar_url || BOT_AVATAR,
  };
}

// ===== Типы авто-сообщений =====
export type BotKind =
  | "welcome"
  | "order_status"
  | "faq"
  | "quick_reply"
  | "escalation"
  | "payment_reminder";

export interface QuickReply {
  label: string;       // текст кнопки
  action: string;      // действие при клике ("faq:delivery", "human:operator")
  payload?: Record<string, unknown>;
}

export interface SendMessageParams {
  roomId: string;
  text: string;
  botKind?: BotKind;
  quickReplies?: QuickReply[];
  metadata?: Record<string, unknown>;
}

interface ChatMessageRow {
  id: string;
}

/**
 * Отправить авто-сообщение от лица бота в чат.
 *
 * Поддерживает оба хранилища (p1-b):
 *  - chat_channels (id — UUID): вставка с channel_id + quick_replies-колонкой,
 *    метрики канала обновляются в chat_channels — так сообщения видны
 *    единственному живому UI (GET /api/chat/rooms → ChatWidget);
 *  - легаси chat_rooms (id — текст, «r1/r2/r3»-комнаты auto-reply): старый
 *    путь без изменений.
 */
export async function sendBotMessage(params: SendMessageParams): Promise<ChatMessageRow | null> {
  let bot: { id: string; name: string; avatar: string };
  try {
    bot = await getBotUser();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chat-bot] getBotUser failed:", msg);
    return null;
  }

  // Канал или легаси-комната?
  const { data: ch } = await supabaseAdmin
    .from("chat_channels")
    .select("id")
    .eq("id", params.roomId)
    .limit(1) as { data: { id: string }[] | null };
  const isChannel = Array.isArray(ch) && ch.length > 0;

  if (isChannel) {
    const { data: message, error: msgErr } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        channel_id: params.roomId,
        sender_id: bot.id,
        text: params.text,
        is_system: true,
        is_bot: true,
        bot_kind: params.botKind || "order_status",
        quick_replies: params.quickReplies || [],
        metadata: params.metadata || {},
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single() as { data: ChatMessageRow | null; error: SupabaseError | null };

    if (msgErr || !message) {
      console.error("[chat-bot] channel message insert failed:", msgErr?.message);
      return null;
    }

    // Метрики канала (0004): чтобы комната поднялась вверх списка
    const { error: chErr } = await supabaseAdmin
      .from("chat_channels")
      .update({
        last_message_text: params.text.slice(0, 120),
        last_message_at: new Date().toISOString(),
      })
      .eq("id", params.roomId);
    if (chErr) console.warn("[chat-bot] channel update failed:", chErr.message);

    return message;
  }

  // Легаси-путь (chat_rooms, auto-reply) — без изменений
  const { data: message, error: msgErr } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      room_id: params.roomId,
      sender_id: bot.id,
      text: params.text,
      is_system: true,
      is_bot: true,
      bot_kind: params.botKind || "order_status",
      metadata: {
        quickReplies: params.quickReplies || [],
        ...params.metadata,
      },
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single() as { data: ChatMessageRow | null; error: SupabaseError | null };

  if (msgErr || !message) {
    console.error("[chat-bot] message insert failed:", msgErr?.message);
    return null;
  }

  // Обновляем lastMessage в комнате
  const { error: roomErr } = await supabaseAdmin
    .from("chat_rooms")
    .update({
      last_message: params.text,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", params.roomId);

  if (roomErr) {
    console.warn("[chat-bot] room update failed:", roomErr.message);
  }

  return message;
}

// ===== Создание чата для заказа =====

/**
 * Создать чат для заказа + welcome-сообщение.
 *
 * p1-b: консолидировано на chat_channels + chat_channel_members (единый
 * контракта с GET /api/chat/rooms и ChatWidget; легаси chat_rooms больше НЕ
 * используется). Find-or-create и membership обоих участников — в общем
 * хелпере ensureOrderChatChannel (идемпотентен, миграция 0058).
 * Идемпотентно: если комната уже есть — возвращаем её (welcome НЕ повторяем).
 */
export async function ensureOrderChatRoom(orderId: string): Promise<string> {
  const { channel, created, order } = await ensureOrderChatChannel(orderId);
  if (!created) return channel.id;

  // Получаем items заказа для welcome-сообщения
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("order_items")
    .select("title, quantity, price")
    .eq("order_id", orderId) as { data: OrderItemForChat[] | null; error: SupabaseError | null };

  if (itemsErr) {
    console.warn("[chat-bot] items load failed:", itemsErr.message);
  }

  // Welcome-сообщение с quick replies
  const itemsList = (items || [])
    .map((i) => `  • ${i.title} × ${i.quantity} = ${i.price * i.quantity}₽`)
    .join("\n");

  await sendBotMessage({
    roomId: channel.id,
    text:
      `🤖 Добро пожаловать! Я — Уездный помощник, сопроводитель вашего заказа №${order.number}.\n\n` +
      `📋 Состав заказа:\n${itemsList || "(нет товаров)"}\n\n` +
      `💰 Итого: ${order.total}₽\n\n` +
      `Я буду держать вас в курсе статуса заказа. Если есть вопросы — задавайте, я постараюсь помочь.`,
    botKind: "welcome",
    quickReplies: [
      { label: "Когда привезут?", action: "faq:delivery_time" },
      { label: "Как оплатить?", action: "faq:payment" },
      { label: "Изменить состав", action: "faq:modify_order" },
      { label: "Соединить с оператором", action: "human:operator" },
    ],
    metadata: { orderId: order.id, orderNumber: order.number },
  });

  return channel.id;
}

// ===== Триггеры по статусам =====

interface OrderStatusTrigger {
  orderId: string;
  fromStatus?: string;
  toStatus: string;
  extra?: { reason?: string; amount?: number };
}

interface StatusTemplateContext {
  number: string;
  total: number;
  deliveryAddress?: string | null;
  deliveryDate?: string | null;
  deliveryTime?: string | null;
  extra?: { reason?: string; amount?: number };
}

const STATUS_MESSAGES: Record<string, { text: (o: StatusTemplateContext) => string; quickReplies?: QuickReply[] }> = {
  CONFIRMED: {
    text: (o) => {
      const dateStr = o.deliveryDate
        ? new Date(o.deliveryDate).toLocaleDateString("ru-RU")
        : "не указана";
      return `✅ Кондитер принял заказ #${o.number}. Начнёт готовку в ближайшее время.\n` +
        `📅 Запланированная дата доставки: ${dateStr}.`;
    },
    quickReplies: [
      { label: "Когда привезут?", action: "faq:delivery_time" },
      { label: "Контакты кондитера", action: "faq:confectioner_contacts" },
    ],
  },
  IN_PROGRESS: {
    text: (o) =>
      `👨‍🍳 Кондитер начал готовку заказа #${o.number}. Обычно это занимает 1-3 дня.\n` +
      `Сообщение будет отправлено, когда заказ будет готов.`,
    quickReplies: [
      { label: "Можно ли изменить?", action: "faq:modify_order" },
    ],
  },
  READY: {
    text: (o) =>
      `🎉 Заказ #${o.number} готов! Ожидает передачи курьеру.\n` +
      `Адрес доставки: ${o.deliveryAddress || "самовывоз"}.`,
    quickReplies: [
      { label: "Когда привезут?", action: "faq:delivery_time" },
      { label: "Контакты курьера", action: "faq:courier_contacts" },
    ],
  },
  DELIVERING: {
    text: (o) =>
      `🚚 Курьер в пути с заказом #${o.number}! Ориентировочное время доставки: ${o.deliveryTime || "в течение дня"}.`,
    quickReplies: [
      { label: "Где курьер?", action: "faq:courier_location" },
      { label: "Позвонить курьеру", action: "faq:courier_phone" },
    ],
  },
  COMPLETED: {
    text: (o) =>
      `✨ Заказ #${o.number} завершён! Спасибо, что выбрали «Уездный кондитер».\n` +
      `Пожалуйста, оставьте отзыв — это поможет другим покупателям и поддержит кондитера.\n\n` +
      `🎁 Вам начислено ${Math.floor(o.total / 100)} бонусов.`,
    quickReplies: [
      { label: "Оставить отзыв", action: "review:leave" },
      { label: "Заказать ещё", action: "order:new" },
    ],
  },
  CANCELLED: {
    text: (o) =>
      `❌ Заказ #${o.number} отменён.\n` +
      (o.extra?.reason ? `Причина: ${o.extra.reason}\n` : "") +
      `💰 Возврат средств будет выполнен в течение 3 рабочих дней на ту же карту,` +
      ` которой оплачивали. Бонусы возвращены на ваш счёт.`,
    quickReplies: [
      { label: "Заказать ещё", action: "order:new" },
      { label: "Соединить с оператором", action: "human:operator" },
    ],
  },
  DISPUTE: {
    text: (o) =>
      `⚠️ По заказу #${o.number} открыт спор. Наш модератор рассмотрит обращение в течение 24 часов.\n` +
      `В это время средства находятся на эскроу-счёте — кондитер их не получит, пока спор не закрыт.\n` +
      `Пожалуйста, предоставьте фото и подробное описание проблемы.`,
    quickReplies: [
      { label: "Загрузить фото", action: "dispute:upload_photo" },
      { label: "Соединить с оператором", action: "human:operator" },
    ],
  },
  PENDING: {
    text: (o) =>
      `⏳ Заказ #${o.number} ожидает подтверждения кондитером. Обычно кондитеры отвечают в течение 1-2 часов.\n` +
      `Если в течение 24 часов заказа не подтвердят — он будет автоматически отменён с полным возвратом.`,
    quickReplies: [
      { label: "Отменить заказ", action: "order:cancel" },
      { label: "Подробнее об эскроу", action: "faq:escrow" },
    ],
  },
};

/**
 * Отправить авто-сообщение при смене статуса заказа.
 * Вызывается из webhook / order status update endpoint.
 */
export async function notifyOrderStatusChange(trigger: OrderStatusTrigger): Promise<void> {
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("id, number, total, delivery_address, delivery_date, delivery_time, customer_id")
    .eq("id", trigger.orderId)
    .maybeSingle() as { data: OrderRow | null; error: SupabaseError | null };

  if (error || !order) {
    console.warn(`[chat-bot] Order ${trigger.orderId} not found`);
    return;
  }

  const template = STATUS_MESSAGES[trigger.toStatus];
  if (!template) {
    console.log(`[chat-bot] No template for status ${trigger.toStatus}, skipping`);
    return;
  }

  try {
    const roomId = await ensureOrderChatRoom(trigger.orderId);
    await sendBotMessage({
      roomId,
      text: template.text({
        number: order.number,
        total: order.total,
        deliveryAddress: order.delivery_address,
        deliveryDate: order.delivery_date,
        deliveryTime: order.delivery_time,
        extra: trigger.extra,
      }),
      botKind: "order_status",
      quickReplies: template.quickReplies,
      metadata: {
        orderId: order.id,
        orderNumber: order.number,
        statusFrom: trigger.fromStatus,
        statusTo: trigger.toStatus,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[chat-bot] notifyOrderStatusChange failed:", msg);
  }
}

// ===== Напоминание об оплате =====

/**
 * Отправить напоминание об оплате (если заказ создан, но не оплачен > 1 час).
 * Вызывается из cron /api/cron/abandoned-cart.
 */
export async function sendPaymentReminder(orderId: string): Promise<void> {
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("id, number, total")
    .eq("id", orderId)
    .maybeSingle() as { data: { id: string; number: string; total: number } | null; error: SupabaseError | null };

  if (error || !order) {
    console.warn(`[chat-bot] Order ${orderId} not found for payment reminder`);
    return;
  }

  try {
    const roomId = await ensureOrderChatRoom(orderId);
    await sendBotMessage({
      roomId,
      text:
        `⏰ Напоминание: заказ #${order.number} на сумму ${order.total}₽ ожидает оплаты.\n` +
        `Если не оплатить в течение 24 часов — заказ будет отменён автоматически.`,
      botKind: "payment_reminder",
      quickReplies: [
        { label: "Оплатить сейчас", action: "payment:pay_now", payload: { orderId: order.id } },
        { label: "Отменить заказ", action: "order:cancel" },
      ],
      metadata: { orderId: order.id },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[chat-bot] sendPaymentReminder failed:", msg);
  }
}
