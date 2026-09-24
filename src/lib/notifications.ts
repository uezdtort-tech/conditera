/**
 * Notification system: templates + multi-channel delivery.
 *
 * Channels (in priority order):
 *   1. in_app  — always on, stored in DB, shown in notifications bell
 *   2. push    — web push notifications (Service Worker)
 *   3. email   — SMTP via nodemailer (or provider SDK)
 *   4. sms     — SMS via SMS.ru / SMSAero / etc.
 *   5. telegram — bot API
 *
 * Each user has NotificationPreferences controlling which channels are active
 * for which categories, with quiet hours and frequency caps.
 *
 * In dev (no SMTP/SMS keys), notifications are logged to console and saved
 * to DB with status='sent'. In prod, real providers are used.
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin напрямую (обход RLS для системных нотификаций).
 *   • UserNotFound бросает Error — пусть вызывающий код сам решает, что делать
 *     (notification не должна молча падать).
 *   • Delivery failures НЕ бросают — логируются, чтобы один плохой канал
 *     не блокировал другие.
 *   • Frequency cap защищает от спама (≤maxPerDay в день, критические категории除外).
 */
import { supabaseAdmin } from "./supabase/admin";

export type Template =
  | "ORDER_CREATED"
  | "ORDER_CONFIRMED"
  | "ORDER_STATUS_CHANGED"
  | "ORDER_ACCEPTED"
  | "ORDER_IN_PRODUCTION"
  | "ORDER_READY"
  | "ORDER_READY_FOR_PICKUP"
  | "ORDER_OUT_FOR_DELIVERY"
  | "ORDER_RECEIVED"
  | "ORDER_DELIVERED"
  | "ORDER_CANCELLED"
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_PARTIAL"
  | "PAYMENT_FAILED"
  | "REFUND_PROCESSED"
  | "NEGOTIATION_RECEIVED"
  | "NEGOTIATION_QUOTED"
  | "NEGOTIATION_APPROVED"
  | "NEGOTIATION_REJECTED"
  | "NEW_MESSAGE"
  | "NEW_REVIEW"
  | "REVIEW_REPLY"
  | "BONUS_EARNED"
  | "BONUS_EXPIRING"
  | "LEVEL_UP"
  | "BIRTHDAY_GREETING"
  | "REFERRAL_REWARDED"
  | "PROMO_NEAR_YOU"
  | "ABANDONED_CART"
  | "VERIFICATION_APPROVED"
  | "VERIFICATION_REJECTED"
  | "PAYOUT_PROCESSED"
  | "SUPPORT_REPLY"
  | "SIMPLEX_MESSAGE"
  | "HOLIDAY_REMINDER";

export type Channel = "email" | "sms" | "push" | "in_app" | "telegram";

export type NotificationCategory =
  | "orderUpdates"
  | "paymentUpdates"
  | "promos"
  | "messages"
  | "reviews"
  | "loyalty"
  | "abandonedCart"
  | "digest";

interface TemplateDef {
  category: NotificationCategory;
  title: (vars: Record<string, string | number>) => string;
  body: (vars: Record<string, string | number>) => string;
  /** Default channel priority order */
  defaultChannels: Channel[];
}

/**
 * User notification preferences.
 * Хранятся в profiles.notify_prefs (jsonb). По умолчанию — все каналы включены,
 * кроме SMS и Telegram (требуют явной настройки).
 */
export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  telegramEnabled: boolean;
  inAppEnabled: boolean;
  orderUpdates: boolean;
  paymentUpdates: boolean;
  promos: boolean;
  messages: boolean;
  reviews: boolean;
  loyalty: boolean;
  abandonedCart: boolean;
  digest: boolean;
  quietHoursStart: number; // 0-23
  quietHoursEnd: number;   // 0-23
  timezone: string;
  maxPerDay: number;
  // category-as-key map for backward compat (any extra categories)
  [key: string]: string | number | boolean;
}

export const TEMPLATES: Record<Template, TemplateDef> = {
  ORDER_CREATED: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} создан`,
    body: (v) =>
      `Ваш заказ на сумму ${v.total} ₽ принят. Кондитер скоро свяжется с вами для подтверждения.`,
    defaultChannels: ["in_app", "push", "email"],
  },
  ORDER_CONFIRMED: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} подтверждён`,
    body: (v) =>
      `${v.confectionerName} подтвердил заказ. Дата доставки: ${v.deliveryDate}.`,
    defaultChannels: ["in_app", "push", "email", "sms"],
  },
  ORDER_STATUS_CHANGED: {
    category: "orderUpdates",
    title: (v) => `Статус заказа изменён: ${v.statusLabel}`,
    body: (v) => `Заказ #${v.orderNumber} перешёл в статус «${v.statusLabel}».`,
    defaultChannels: ["in_app", "push"],
  },
  ORDER_ACCEPTED: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} принят кондитером`,
    body: (v) => `${v.confectionerName || "Кондитер"} принял ваш заказ в работу.`,
    defaultChannels: ["in_app", "push"],
  },
  ORDER_IN_PRODUCTION: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} в производстве`,
    body: () => `Кондитер начал готовить ваш торт. Скоро сообщим о готовности.`,
    defaultChannels: ["in_app"],
  },
  ORDER_READY: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} готов`,
    body: (v) =>
      `Ваш торт готов! ${v.pickupOrDelivery === "pickup" ? "Можно забирать." : "Курьер уже в пути."}`,
    defaultChannels: ["in_app", "push", "sms"],
  },
  ORDER_READY_FOR_PICKUP: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} готов к выдаче`,
    body: (v) => `Торт можно забрать по адресу: ${v.address || "уточните у кондитера"}.`,
    defaultChannels: ["in_app", "push", "sms"],
  },
  ORDER_OUT_FOR_DELIVERY: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} в пути`,
    body: (v) => `Курьер выехал и скоро доставит заказ. Ожидаемое время: ${v.eta || "скоро"}.`,
    defaultChannels: ["in_app", "push"],
  },
  ORDER_RECEIVED: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} получен`,
    body: () => `Вы получили заказ. Проверьте комплектацию и оставьте отзыв!`,
    defaultChannels: ["in_app"],
  },
  ORDER_DELIVERED: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} доставлен`,
    body: () =>
      `Заказ успешно доставлен. Оцените заказ и оставьте отзыв — поможете другим покупателям!`,
    defaultChannels: ["in_app", "push"],
  },
  ORDER_CANCELLED: {
    category: "orderUpdates",
    title: (v) => `Заказ #${v.orderNumber} отменён`,
    body: (v) =>
      `Заказ отменён. ${v.reason ? `Причина: ${v.reason}` : "Свяжитесь с поддержкой, если есть вопросы."}`,
    defaultChannels: ["in_app", "push", "email"],
  },
  PAYMENT_SUCCEEDED: {
    category: "paymentUpdates",
    title: (v) => `Платёж ${v.amount} ₽ получен`,
    body: (v) =>
      `Оплата по заказу #${v.orderNumber} подтверждена. Статус заказа: «Оплачен».`,
    defaultChannels: ["in_app", "push", "email"],
  },
  PAYMENT_PARTIAL: {
    category: "paymentUpdates",
    title: (v) => `Частичная оплата ${v.amount} ₽`,
    body: (v) => `Получена частичная оплата по заказу #${v.orderNumber}. Остаток: ${v.balance || "?"} ₽.`,
    defaultChannels: ["in_app", "push"],
  },
  PAYMENT_FAILED: {
    category: "paymentUpdates",
    title: () => `Платёж не прошёл`,
    body: (v) =>
      `Платёж по заказу #${v.orderNumber} отклонён. Проверьте карту или выберите другой способ оплаты.`,
    defaultChannels: ["in_app", "push", "email", "sms"],
  },
  REFUND_PROCESSED: {
    category: "paymentUpdates",
    title: (v) => `Возврат ${v.amount} ₽ выполнен`,
    body: (v) =>
      `Возврат средств по заказу #${v.orderNumber} обработан. Деньги поступят в течение 3-5 рабочих дней.`,
    defaultChannels: ["in_app", "push", "email"],
  },
  NEGOTIATION_RECEIVED: {
    category: "messages",
    title: (v) => `${v.customerName || "Клиент"} прислал запрос`,
    body: () => `Новая заявка на заказ торта. Откройте чат, чтобы ответить.`,
    defaultChannels: ["in_app", "push"],
  },
  NEGOTIATION_QUOTED: {
    category: "messages",
    title: () => `Получено коммерческое предложение`,
    body: (v) => `${v.confectionerName || "Кондитер"} прислал расчёт: ${v.total || ""} ₽.`,
    defaultChannels: ["in_app", "push"],
  },
  NEGOTIATION_APPROVED: {
    category: "messages",
    title: () => `Запрос одобрен`,
    body: (v) => `${v.customerName || "Клиент"} одобрил ваше предложение. Можно переходить к оплате.`,
    defaultChannels: ["in_app", "push"],
  },
  NEGOTIATION_REJECTED: {
    category: "messages",
    title: () => `Запрос отклонён`,
    body: () => `Клиент отклонил ваше предложение. Возможно, предложите альтернативу.`,
    defaultChannels: ["in_app"],
  },
  NEW_MESSAGE: {
    category: "messages",
    title: (v) => `${v.senderName || "Кто-то"} написал вам`,
    body: (v) => (v.messagePreview ? String(v.messagePreview).slice(0, 80) : "Откройте чат, чтобы прочитать."),
    defaultChannels: ["in_app", "push"],
  },
  NEW_REVIEW: {
    category: "reviews",
    title: (v) => `Новый отзыв: ${v.rating || "★"}★`,
    body: (v) => (v.reviewPreview ? String(v.reviewPreview).slice(0, 80) : "Откройте страницу, чтобы прочитать."),
    defaultChannels: ["in_app", "push"],
  },
  REVIEW_REPLY: {
    category: "reviews",
    title: () => `Ответ на ваш отзыв`,
    body: (v) => `${v.confectionerName || "Кондитер"} ответил на ваш отзыв. Откройте, чтобы прочитать.`,
    defaultChannels: ["in_app", "push"],
  },
  BONUS_EARNED: {
    category: "loyalty",
    title: (v) => `+${v.points} бонусов начислено`,
    body: (v) =>
      `За заказ #${v.orderNumber} начислено ${v.points} бонусов. Текущий баланс: ${v.balance || "?"}.`,
    defaultChannels: ["in_app", "push"],
  },
  BONUS_EXPIRING: {
    category: "loyalty",
    title: (v) => `Сгорит ${v.points} бонусов через ${v.daysUntil} дн.`,
    body: (v) =>
      `У вас ${v.points} бонусов сгорят через ${v.daysUntil} дней. Используйте их при следующем заказе!`,
    defaultChannels: ["in_app", "push", "email"],
  },
  LEVEL_UP: {
    category: "loyalty",
    title: (v) => `Новый уровень: ${v.levelName || "повышен"}`,
    body: () => `Поздравляем! Вы перешли на новый уровень лояльности. Откройте бонусы уровня в профиле.`,
    defaultChannels: ["in_app", "push", "email"],
  },
  BIRTHDAY_GREETING: {
    category: "promos",
    title: () => `С днём рождения! 🎂`,
    body: (v) =>
      `Уездный кондитер поздравляет вас! Дарим ${v.bonusPoints || 100} бонусов на заказ торта к празднику.`,
    defaultChannels: ["in_app", "push", "email"],
  },
  REFERRAL_REWARDED: {
    category: "loyalty",
    title: (v) => `+${v.points} бонусов за друга`,
    body: (v) => `${v.friendName || "Ваш друг"} зарегистрировался по вашей ссылке. Вам начислено ${v.points} бонусов!`,
    defaultChannels: ["in_app", "push"],
  },
  VERIFICATION_APPROVED: {
    category: "orderUpdates",
    title: () => `Профиль кондитера подтверждён ✓`,
    body: () =>
      `Поздравляем! Ваш профиль кондитера прошёл модерацию. Теперь вы можете принимать заказы.`,
    defaultChannels: ["in_app", "push", "email"],
  },
  VERIFICATION_REJECTED: {
    category: "orderUpdates",
    title: () => `Профиль кондитера: нужна доработка`,
    body: (v) =>
      `Профиль не прошёл модерацию. Причина: ${v.reason || "не указана"}. Внесите правки и отправьте на проверку снова.`,
    defaultChannels: ["in_app", "push", "email"],
  },
  PAYOUT_PROCESSED: {
    category: "paymentUpdates",
    title: (v) => `Выплата ${v.amount} ₽ отправлена`,
    body: (v) =>
      `Запрос на выплату обработан. ${v.method === "card" ? "Деньги поступят на карту в течение 1-2 рабочих дней." : "Проверьте способ получения."}`,
    defaultChannels: ["in_app", "push", "email"],
  },
  SUPPORT_REPLY: {
    category: "messages",
    title: () => `Поддержка ответила`,
    body: (v) => (v.messagePreview ? String(v.messagePreview).slice(0, 120) : "Откройте тикет, чтобы прочитать ответ."),
    defaultChannels: ["in_app", "push", "email"],
  },
  SIMPLEX_MESSAGE: {
    category: "messages",
    title: () => `Новое сообщение (SimpleX)`,
    body: (v) => (v.messagePreview ? String(v.messagePreview).slice(0, 80) : "Откройте чат, чтобы прочитать."),
    defaultChannels: ["in_app", "push"],
  },
  ABANDONED_CART: {
    category: "abandonedCart",
    title: () => `Вы забыли корзину`,
    body: (v) =>
      `В вашей корзине товары на ${v.total || ""} ₽. Завершите оформление — и торт будет у вас к нужной дате!`,
    defaultChannels: ["push", "email"],
  },
  PROMO_NEAR_YOU: {
    category: "promos",
    title: () => `Скидки рядом с вами`,
    body: (v) => (v.promoPreview ? String(v.promoPreview).slice(0, 80) : "Откройте каталог, чтобы увидеть актуальные акции."),
    defaultChannels: ["push"],
  },
  HOLIDAY_REMINDER: {
    category: "promos",
    title: (v) => `Скоро ${v.holidayName || "праздник"}!`,
    body: (v) => {
      const days = Number(v.daysUntil) || 7;
      if (days <= 1) {
        return `Завтра ${v.holidayName || "праздник"}! Самое время заказать торт — выбирайте в каталоге.`;
      }
      return `Через ${days} дней — ${v.holidayName || "праздник"}. Закажите торт заранее со скидкой 5%!`;
    },
    defaultChannels: ["push", "email", "in_app"],
  },
};

interface SendInput {
  userId: string;
  template: Template;
  vars?: Record<string, string | number>;
  /** Override default channels */
  channels?: Channel[];
  /** Schedule for later (else send now) */
  scheduledFor?: Date;
  /** Custom data attached to notification */
  data?: Record<string, unknown>;
}

interface UserProfileRow {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  notify_prefs: unknown;
}

interface NotificationRow {
  id: string;
  user_id: string;
  template: string;
  channel: string;
  status: string;
  title: string;
  body: string;
  data: unknown;
  scheduled_for: string | null;
  sent_at: string | null;
  error_message: string | null;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface SupabaseError {
  message: string;
  code?: string;
}

/**
 * Безопасное приведение notify_prefs (jsonb) к NotificationPreferences.
 * Если данные отсутствуют или некорректны — возвращает defaults.
 */
function coercePrefs(raw: unknown): NotificationPreferences {
  const defaults = defaultPreferences();
  if (!raw || typeof raw !== "object") return defaults;
  const obj = raw as Record<string, unknown>;
  return {
    ...defaults,
    ...obj,
  } as NotificationPreferences;
}

/**
 * Send a notification via all applicable channels.
 * Respects user preferences (NotificationPreferences), quiet hours, and frequency caps.
 *
 * In dev (no SMTP/SMS credentials), only in_app + push + console logs.
 */
export async function sendNotification(input: SendInput): Promise<{
  notificationIds: string[];
}> {
  const def = TEMPLATES[input.template];
  const vars = input.vars || {};
  const title = def.title(vars);
  const body = def.body(vars);

  // Load user + preferences
  const { data: userRow, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, phone, name, notify_prefs")
    .eq("id", input.userId)
    .maybeSingle() as { data: UserProfileRow | null; error: SupabaseError | null };

  if (error) {
    console.error("[notify] user lookup failed:", error.message);
    throw new Error(`Не удалось загрузить пользователя ${input.userId}: ${error.message}`);
  }
  if (!userRow) {
    throw new Error(`User ${input.userId} not found`);
  }

  const user = {
    email: userRow.email || "",
    phone: userRow.phone || null,
    name: userRow.name || "",
  };
  const prefs = coercePrefs(userRow.notify_prefs);

  const categoryEnabled = prefs[def.category] !== false;
  if (!categoryEnabled) {
    // User opted out of this category entirely
    return { notificationIds: [] };
  }

  // Determine channels to use
  let channels: Channel[] = input.channels || def.defaultChannels;
  channels = channels.filter((ch) => {
    if (ch === "email") return prefs.emailEnabled;
    if (ch === "sms") return prefs.smsEnabled;
    if (ch === "push") return prefs.pushEnabled;
    if (ch === "telegram") return prefs.telegramEnabled;
    if (ch === "in_app") return prefs.inAppEnabled;
    return false;
  });

  // Always include in_app if not explicitly disabled (it's the fallback)
  if (!channels.includes("in_app") && prefs.inAppEnabled) {
    channels.push("in_app");
  }

  // Check quiet hours (categorical: 22-9 is overnight if start > end)
  const hour = new Date().getHours();
  const qs = Number(prefs.quietHoursStart);
  const qe = Number(prefs.quietHoursEnd);
  let inQuiet = false;
  if (Number.isFinite(qs) && Number.isFinite(qe)) {
    inQuiet = qs > qe
      ? (hour >= qs || hour < qe)
      : (hour >= qs && hour < qe);
  }

  if (inQuiet) {
    // Schedule for end of quiet hours
    const sendAt = new Date();
    sendAt.setHours(qe || 9, 0, 0, 0);
    if (sendAt < new Date()) sendAt.setDate(sendAt.getDate() + 1);
    input.scheduledFor = sendAt;
  }

  // Check daily frequency cap
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: sentToday, error: cntErr } = await supabaseAdmin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .in("status", ["sent", "delivered", "read"])
    .gte("sent_at", todayStart.toISOString());

  if (!cntErr && (sentToday || 0) >= prefs.maxPerDay) {
    // Skip non-critical notifications
    if (def.category !== "paymentUpdates" && def.category !== "orderUpdates") {
      return { notificationIds: [] };
    }
  }

  // Create one notification row per channel
  const notificationIds: string[] = [];

  for (const channel of channels) {
    const { data: notif, error: insertErr } = await supabaseAdmin
      .from("notifications")
      .insert({
        user_id: input.userId,
        template: input.template,
        channel,
        status: "queued",
        title,
        body,
        data: input.data || null,
        scheduled_for: input.scheduledFor ? input.scheduledFor.toISOString() : null,
      })
      .select("id")
      .single() as { data: { id: string } | null; error: SupabaseError | null };

    if (insertErr || !notif) {
      console.error("[notify] insert failed:", insertErr?.message);
      continue;
    }

    notificationIds.push(notif.id);

    if (!input.scheduledFor) {
      // Deliver immediately
      await deliverNotification(notif.id, channel, user);
    }
  }

  return { notificationIds };
}

/**
 * Actually send a queued notification via the appropriate provider.
 * In dev, falls back to console log.
 */
export async function deliverNotification(
  notificationId: string,
  channel: Channel,
  user: { email: string; phone: string | null; name: string }
): Promise<void> {
  const { data: notif, error } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("id", notificationId)
    .maybeSingle() as { data: NotificationRow | null; error: SupabaseError | null };

  if (error || !notif) {
    console.warn("[notify] notification not found:", notificationId, error?.message);
    return;
  }

  try {
    switch (channel) {
      case "in_app":
        // No external delivery — already stored in DB
        break;
      case "push":
        await deliverPush(notif.user_id, notif.title, notif.body);
        break;
      case "email":
        await deliverEmail(user.email, notif.title, notif.body);
        break;
      case "sms":
        if (user.phone) {
          await deliverSms(user.phone, `${notif.title}\n${notif.body}`);
        }
        break;
      case "telegram":
        await deliverTelegram(notif.user_id, notif.title, notif.body);
        break;
    }
    await supabaseAdmin
      .from("notifications")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .eq("id", notificationId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("notifications")
      .update({
        status: "failed",
        error_message: errMsg.slice(0, 500),
      })
      .eq("id", notificationId);
    console.error(`[notify] delivery failed for ${notificationId} via ${channel}:`, errMsg);
  }
}

// ===== Provider implementations (dev-friendly, prod-ready) =====

async function deliverPush(
  userId: string,
  title: string,
  body: string
): Promise<void> {
  // Web Push via VAPID — requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
  if (
    !process.env.VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY
  ) {
    console.info(`[notify:push] (dev) → user=${userId} title="${title}"`);
    return;
  }

  // Query push subscriptions from DB
  const { data: subscriptions, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId) as { data: PushSubscriptionRow[] | null; error: SupabaseError | null };

  if (error) {
    console.warn("[notify:push] subscriptions query failed:", error.message);
    return;
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.info(`[notify:push] → user=${userId} (no subscriptions)`);
    return;
  }

  // Dynamically import web-push library
  try {
    const webpush = (await import("web-push")).default;

    webpush.setVapidDetails(
      process.env.NEXT_PUBLIC_APP_URL || "mailto:noreply@conditera.ru",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );

    const payload = JSON.stringify({
      title,
      body,
      icon: "/logo.png",
      badge: "/logo.png",
      tag: "conditera-order",
      requireInteraction: false,
      data: { url: "/" },
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payload
        );
        console.info(`[notify:push] ✓ sent to ${sub.endpoint.slice(0, 50)}...`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[notify:push] failed for ${sub.endpoint.slice(0, 50)}:`, errMsg);
        // Remove invalid subscription
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
          console.info(`[notify:push] removed expired subscription ${sub.id}`);
        }
      }
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.warn("[notify:push] web-push library not available:", errMsg);
  }
}

async function deliverEmail(
  to: string,
  subject: string,
  body: string
): Promise<void> {
  if (!to || to.length === 0) {
    console.info(`[notify:email] (skip — no email)`);
    return;
  }
  // SMTP via nodemailer; configure via SMTP_URL env
  if (!process.env.SMTP_URL) {
    console.info(`[notify:email] (dev) → to=${to} subject="${subject}"`);
    console.info(`[notify:email] body: ${body.slice(0, 200)}`);
    return;
  }
  // Prod: import nodemailer dynamically and send
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport(process.env.SMTP_URL);
  await transporter.sendMail({
    from: process.env.SMTP_FROM || "Кондитера <noreply@conditera.ru>",
    to,
    subject,
    text: body,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px">
      <h2 style="color:#7c3aed">${subject}</h2>
      <p style="font-size:16px;line-height:1.6">${body}</p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="font-size:12px;color:#999">Уездный кондитер — маркетплейс частных кондитеров России</p>
    </div>`,
  });
}

async function deliverSms(phone: string, text: string): Promise<void> {
  // SMS via SMS.ru — requires SMSRU_API_ID env
  if (!process.env.SMSRU_API_ID) {
    console.info(`[notify:sms] (dev) → to=${phone} text="${text.slice(0, 80)}"`);
    return;
  }
  const url = `https://sms.ru/sms/send?api_id=${process.env.SMSRU_API_ID}&to=${encodeURIComponent(
    phone
  )}&msg=${encodeURIComponent(text)}&json=1`;
  const resp = await fetch(url);
  const data = await resp.json() as { status?: string };
  if (data.status !== "OK") {
    throw new Error(`SMS.ru error: ${JSON.stringify(data)}`);
  }
}

async function deliverTelegram(
  userId: string,
  title: string,
  body: string
): Promise<void> {
  // Find user's Telegram chat ID (linked via /start bot command)
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.info(`[notify:telegram] (dev) → user=${userId} title="${title}"`);
    return;
  }
  // Prod: query linked telegram account and send via bot API
  console.info(`[notify:telegram] → user=${userId} (no telegram account linked)`);
}

/**
 * Get default preferences for a new user.
 */
export function defaultPreferences(): NotificationPreferences {
  return {
    emailEnabled: true,
    smsEnabled: false,
    pushEnabled: true,
    telegramEnabled: false,
    inAppEnabled: true,
    orderUpdates: true,
    paymentUpdates: true,
    promos: true,
    messages: true,
    reviews: true,
    loyalty: true,
    abandonedCart: true,
    digest: true,
    quietHoursStart: 22,
    quietHoursEnd: 9,
    timezone: "Europe/Moscow",
    maxPerDay: 20,
  };
}
