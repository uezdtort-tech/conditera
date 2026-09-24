/**
 * Email — отправка и приём почтовых уведомлений.
 *
 * Возможности:
 *  1. Отправка транзакционных писем через Nodemailer (SMTP)
 *  2. Шаблоны писем (welcome, order_created, ticket_reply, payment_succeeded)
 *  3. Сохранение всех писем в БД (EmailMessage)
 *  4. Приём входящих через webhook (/api/email/inbound)
 *  5. Поддержка любого SMTP: Mailu (self-hosted), Яндекс 360, Mailgun, SendGrid
 *
 * Настройка SMTP (в .env.production):
 *   SMTP_HOST=mail.conditera.ru        # или smtp.yandex.ru, smtp.mailgun.org
 *   SMTP_PORT=587                      # 587 (STARTTLS) или 465 (SSL)
 *   SMTP_USER=noreply@conditera.ru
 *   SMTP_PASSWORD=...
 *   SMTP_FROM="Кондитера <noreply@conditera.ru>"
 *   SMTP_SECURE=false                  # true для порта 465, false для 587
 *
 * Документация: https://nodemailer.com/
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin.
 *   • sendEmail не бросает исключения — возвращает {success, error}.
 *   • При сбое SMTP письмо сохраняется в БД со status='failed' и errorMessage.
 *   • SMTP credentials берутся из env, не хардкодятся.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { supabaseAdmin } from "./supabase/admin";

interface SupabaseError {
  message: string;
}

// ===== SMTP client (singleton) =====
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (!host) {
    console.warn("[email] SMTP not configured — set SMTP_HOST");
    return null;
  }

  // For Mailpit/dev — SMTP_USER and SMTP_PASSWORD can be empty
  const auth = (user && pass) ? { user, pass } : undefined;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
    // Для self-hosted Mailu/Postfix/Mailpit — не требовать валидный сертификат
    tls: process.env.SMTP_TLS_REJECT_UNAUTHORIZED === "0" || process.env.SMTP_TLS_REJECT_UNAUTHORIZED === "false"
      ? { rejectUnauthorized: false }
      : undefined,
  });

  return transporter;
}

// ===== Types =====
export interface SendEmailOptions {
  to: string
  toName?: string
  subject: string
  text?: string
  html?: string
  // Связь с сущностями (опционально)
  userId?: string
  orderId?: string
  ticketId?: string
  leadId?: string
  // Шаблон (для журнала)
  template?: string
  // Reply-To (чтобы пользователь мог ответить)
  replyTo?: string
  // Вложения
  attachments?: Array<{
    filename: string
    content: Buffer | string
    contentType?: string
  }>
  // Message-ID письма, на которое это отвечает (для thread)
  inReplyTo?: string
}

export interface EmailTemplate {
  subject: string
  text: string
  html: string
}

// ===== Core: send email =====

/**
 * Отправить email через SMTP и сохранить в БД.
 * Не выбрасывает ошибки — возвращает результат.
 */
export async function sendEmail(options: SendEmailOptions): Promise<{
  success: boolean
  messageId?: string
  emailId?: string
  error?: string
}> {
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@conditera.ru";
  const fromMatch = fromAddress.match(/^(.+?)\s*<(.+)>$/);
  const fromName = fromMatch ? fromMatch[1].trim().replace(/^"|"$/g, "") : "Кондитера";
  const fromEmail = fromMatch ? fromMatch[2] : fromAddress;

  // Генерируем Message-ID
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@conditera.ru>`;

  // Сохраняем в БД (pending)
  const { data: emailRecord, error: insertErr } = await supabaseAdmin
    .from("email_messages")
    .insert({
      direction: "sent",
      from_address: fromEmail,
      from_name: fromName,
      to_address: options.to,
      to_name: options.toName || null,
      subject: options.subject,
      text_body: options.text || null,
      html_body: options.html || null,
      user_id: options.userId || null,
      order_id: options.orderId || null,
      ticket_id: options.ticketId || null,
      lead_id: options.leadId || null,
      template: options.template || null,
      status: "pending",
      message_id: messageId,
      in_reply_to: options.inReplyTo || null,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single() as { data: { id: string } | null; error: SupabaseError | null };

  if (insertErr || !emailRecord) {
    console.error("[email] DB insert failed:", insertErr?.message);
    return { success: false, error: "Не удалось сохранить письмо" };
  }

  const transport = getTransporter();
  if (!transport) {
    await supabaseAdmin
      .from("email_messages")
      .update({
        status: "failed",
        error_message: "SMTP not configured",
        updated_at: new Date().toISOString(),
      })
      .eq("id", emailRecord.id);
    return { success: false, error: "SMTP not configured", emailId: emailRecord.id };
  }

  try {
    const info = await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: options.toName ? `"${options.toName}" <${options.to}>` : options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: options.replyTo || process.env.SMTP_REPLY_TO || fromEmail,
      inReplyTo: options.inReplyTo,
      messageId,
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    // Обновляем статус — отправлено
    await supabaseAdmin
      .from("email_messages")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        external_id: info.messageId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", emailRecord.id);

    console.info(`[email] Sent: ${options.subject} → ${options.to} (${info.messageId})`);
    return { success: true, messageId: info.messageId, emailId: emailRecord.id };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Ошибка отправки
    await supabaseAdmin
      .from("email_messages")
      .update({
        status: "failed",
        error_message: errMsg.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", emailRecord.id);

    console.error(`[email] Failed to send: ${options.subject} → ${options.to}`, errMsg);
    return { success: false, error: errMsg, emailId: emailRecord.id };
  }
}

// ===== Email templates =====

/**
 * Шаблоны писем с HTML-вёрсткой.
 * Все шаблоны используют общий layout (шапка + контент + подвал).
 */
function renderLayout(content: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background: #fef9f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 30px 0; border-bottom: 2px solid #f0e6d9; }
    .header h1 { font-size: 24px; margin: 0; color: #8b4513; font-style: italic; }
    .content { padding: 30px 20px; background: white; border-radius: 8px; margin: 20px 0; }
    .content h2 { color: #8b4513; margin-top: 0; }
    .button { display: inline-block; padding: 12px 28px; background: #8b4513; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 16px 0; }
    .info-box { background: #f8f4ef; padding: 16px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #8b4513; }
    .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; }
    .footer a { color: #8b4513; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f4ef; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🍰 Кондитера</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>© 2026 Уездный кондитер — <a href="https://conditera.ru">conditera.ru</a></p>
      <p>Этот письмо отправлено автоматически. Не отвечайте на него.</p>
    </div>
  </div>
</body>
</html>`;
}

export const EMAIL_TEMPLATES = {
  // === Регистрация ===
  welcome: (params: { name: string; email: string }): EmailTemplate => ({
    subject: "Добро пожаловать в «Уездный кондитер»! 🍰",
    text: `Здравствуйте, ${params.name}!\n\nДобро пожаловать в «Уездный кондитер» — маркетплейс кондитерских изделий.\n\nВаш аккаунт создан. Email: ${params.email}\n\nНачните заказывать торты и десерты напрямую у домашних кондитеров: https://conditera.ru/catalog\n\nС уважением,\nКоманда «Уездного кондитера»`,
    html: renderLayout(`
      <h2>Здравствуйте, ${params.name}! 👋</h2>
      <p>Добро пожаловать в <strong>«Уездный кондитер»</strong> — маркетплейс кондитерских изделий от частных кондитеров.</p>
      <div class="info-box">
        <strong>Ваш email:</strong> ${params.email}<br>
        <strong>Ваш аккаунт:</strong> активирован
      </div>
      <p>Что вы можете делать:</p>
      <ul>
        <li>🍰 Заказывать торты и десерты напрямую у кондитеров</li>
        <li>🎂 Собрать торт в конструкторе</li>
        <li>⭐ Оставлять отзывы и оценивать кондитеров</li>
        <li>🎁 Получать бонусы за заказы</li>
      </ul>
      <a href="https://conditera.ru/catalog" class="button">Открыть каталог</a>
    `, "Добро пожаловать"),
  }),

  // === Новый заказ (клиенту) ===
  order_created: (params: {
    orderNumber: string
    customerName: string
    total: number
    items: { title: string; quantity: number; price: number }[]
    deliveryDate: string
    paymentMethod: string
  }): EmailTemplate => ({
    subject: `Заказ ${params.orderNumber} оформлен 🛒`,
    text: `${params.customerName}, ваш заказ ${params.orderNumber} оформлен!\n\nСумма: ${params.total.toLocaleString("ru-RU")} ₽\nОплата: ${params.paymentMethod}\nДоставка: ${params.deliveryDate}\n\nСостав:\n${params.items.map((i) => `  • ${i.title} ×${i.quantity} — ${i.price} ₽`).join("\n")}\n\nОтследить заказ: https://conditera.ru/dashboard\n\nС уважением,\nКоманда «Уездного кондитера»`,
    html: renderLayout(`
      <h2>${params.customerName}, ваш заказ оформлен! 🎉</h2>
      <div class="info-box">
        <strong>Заказ:</strong> ${params.orderNumber}<br>
        <strong>Сумма:</strong> ${params.total.toLocaleString("ru-RU")} ₽<br>
        <strong>Оплата:</strong> ${params.paymentMethod}<br>
        <strong>Доставка:</strong> ${params.deliveryDate}
      </div>
      <h3>Состав заказа</h3>
      <table>
        <tr><th>Товар</th><th>Кол-во</th><th>Цена</th></tr>
        ${params.items.map((i) => `<tr><td>${i.title}</td><td>${i.quantity}</td><td>${i.price.toLocaleString("ru-RU")} ₽</td></tr>`).join("")}
      </table>
      <a href="https://conditera.ru/dashboard" class="button">Отследить заказ</a>
    `, `Заказ ${params.orderNumber}`),
  }),

  // === Оплата получена ===
  payment_succeeded: (params: {
    orderNumber: string
    customerName: string
    amount: number
    paymentMethod: string
  }): EmailTemplate => ({
    subject: `Оплата получена — заказ ${params.orderNumber} 💳`,
    text: `${params.customerName}, оплата по заказу ${params.orderNumber} получена!\n\nСумма: ${params.amount.toLocaleString("ru-RU")} ₽\nМетод: ${params.paymentMethod}\n\nЗаказ передан кондитеру. Средства находятся в эскроу до завершения заказа.\n\nОтследить: https://conditera.ru/dashboard\n\nС уважением,\nКоманда «Уездного кондитера»`,
    html: renderLayout(`
      <h2>Оплата получена! ✅</h2>
      <p>${params.customerName}, мы получили оплату по вашему заказу.</p>
      <div class="info-box">
        <strong>Заказ:</strong> ${params.orderNumber}<br>
        <strong>Сумма:</strong> ${params.amount.toLocaleString("ru-RU")} ₽<br>
        <strong>Метод:</strong> ${params.paymentMethod}
      </div>
      <p>Заказ передан кондитеру. Средства находятся в <strong>эскроу</strong> — мы переведём их кондитеру только после того, как вы получите заказ.</p>
      <a href="https://conditera.ru/dashboard" class="button">Отследить заказ</a>
    `, `Оплата — ${params.orderNumber}`),
  }),

  // === Ответ на тикет ===
  ticket_reply: (params: {
    ticketNumber: string
    customerName: string
    subject: string
    replyText: string
    supporterName: string
  }): EmailTemplate => ({
    subject: `Ответ по тикету ${params.ticketNumber} 🎫`,
    text: `${params.customerName}, поступил ответ по вашему обращению ${params.ticketNumber}.\n\nТема: ${params.subject}\n\nОтвет:\n${params.replyText}\n\n— ${params.supporterName}, поддержка «Уездного кондитера»\n\nОтветить: https://conditera.ru/dashboard?tab=crm-tickets`,
    html: renderLayout(`
      <h2>Поступил ответ по вашему тикету</h2>
      <div class="info-box">
        <strong>Тикет:</strong> ${params.ticketNumber}<br>
        <strong>Тема:</strong> ${params.subject}
      </div>
      <div style="background:#f8f4ef;padding:16px;border-radius:6px;margin:16px 0;">
        ${params.replyText.replace(/\n/g, "<br>")}
      </div>
      <p style="color:#999;font-size:14px;">— ${params.supporterName}, поддержка «Уездного кондитера»</p>
      <a href="https://conditera.ru/dashboard?tab=crm-tickets" class="button">Ответить в тикете</a>
    `, `Тикет ${params.ticketNumber}`),
  }),

  // === Новый лид (для менеджера) ===
  new_lead: (params: {
    name: string
    email?: string
    phone?: string
    company?: string
    source: string
    need?: string
    budget?: number
  }): EmailTemplate => ({
    subject: `Новый лид: ${params.name} 📞`,
    text: `Новый лид на платформе!\n\nИмя: ${params.name}\n${params.company ? `Компания: ${params.company}\n` : ""}${params.email ? `Email: ${params.email}\n` : ""}${params.phone ? `Телефон: ${params.phone}\n` : ""}Источник: ${params.source}\n${params.budget ? `Бюджет: ${params.budget.toLocaleString("ru-RU")} ₽\n` : ""}${params.need ? `Потребность: ${params.need}\n` : ""}\nОткрыть CRM: https://conditera.ru/dashboard?tab=crm-leads`,
    html: renderLayout(`
      <h2>Новый лид! 📞</h2>
      <div class="info-box">
        <strong>Имя:</strong> ${params.name}<br>
        ${params.company ? `<strong>Компания:</strong> ${params.company}<br>` : ""}
        ${params.email ? `<strong>Email:</strong> ${params.email}<br>` : ""}
        ${params.phone ? `<strong>Телефон:</strong> ${params.phone}<br>` : ""}
        <strong>Источник:</strong> ${params.source}<br>
        ${params.budget ? `<strong>Бюджет:</strong> ${params.budget.toLocaleString("ru-RU")} ₽<br>` : ""}
      </div>
      ${params.need ? `<p><strong>Потребность:</strong> ${params.need}</p>` : ""}
      <a href="https://conditera.ru/dashboard?tab=crm-leads" class="button">Открыть в CRM</a>
    `, "Новый лид"),
  }),

  // === Сброс пароля ===
  password_reset: (params: {
    name: string
    resetUrl: string
    expiresIn: string
  }): EmailTemplate => ({
    subject: "Сброс пароля 🔑",
    text: `${params.name}, вы запросили сброс пароля.\n\nПерейдите по ссылке, чтобы установить новый пароль:\n${params.resetUrl}\n\nСсылка действительна: ${params.expiresIn}\n\nЕсли вы не запрашивали сброс пароля — проигнорируйте это письмо.\n\nС уважением,\nКоманда «Уездного кондитера»`,
    html: renderLayout(`
      <h2>Сброс пароля</h2>
      <p>${params.name}, вы запросили сброс пароля на сайте «Уездный кондитер».</p>
      <p>Нажмите кнопку ниже, чтобы установить новый пароль:</p>
      <a href="${params.resetUrl}" class="button">Сбросить пароль</a>
      <p style="color:#999;font-size:14px;">Ссылка действительна: ${params.expiresIn}</p>
      <p style="color:#999;font-size:14px;">Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.</p>
    `, "Сброс пароля"),
  }),

  // === 2FA код ===
  tfa_code: (params: {
    name: string
    code: string
    expiresIn: string
  }): EmailTemplate => ({
    subject: "Код подтверждения 🔐",
    text: `${params.name}, ваш код для входа:\n\n${params.code}\n\nКод действителен: ${params.expiresIn}\n\nЕсли вы не запрашивали код — кто-то пытается войти в ваш аккаунт. Свяжитесь с поддержкой.\n\nС уважением,\nКоманда «Уездного кондитера»`,
    html: renderLayout(`
      <h2>Код подтверждения</h2>
      <p>${params.name}, ваш код для входа в личный кабинет:</p>
      <div style="text-align:center;font-size:32px;font-weight:bold;letter-spacing:8px;padding:20px;background:#f8f4ef;border-radius:8px;margin:16px 0;color:#8b4513;">
        ${params.code}
      </div>
      <p style="color:#999;font-size:14px;">Код действителен: ${params.expiresIn}</p>
      <p style="color:#999;font-size:14px;">Если вы не запрашивали код — кто-то пытается войти в ваш аккаунт. Свяжитесь с поддержкой: support@conditera.ru</p>
    `, "Код подтверждения"),
  }),
};

// ===== Helper: send template email =====

/**
 * Отправить письмо по шаблону.
 *
 * @example
 *   await sendTemplateEmail("welcome", {
 *     to: user.email,
 *     toName: user.name,
 *     userId: user.id,
 *     template: "welcome",
 *     params: { name: user.name, email: user.email },
 *   })
 */
export async function sendTemplateEmail(
  templateName: keyof typeof EMAIL_TEMPLATES,
  options: {
    to: string
    toName?: string
    userId?: string
    orderId?: string
    ticketId?: string
    leadId?: string
    inReplyTo?: string
    params: Record<string, any>
  }
): Promise<{ success: boolean; error?: string }> {
  const templateFn = EMAIL_TEMPLATES[templateName];
  if (!templateFn) {
    console.error(`[email] Template not found: ${templateName}`);
    return { success: false, error: "Template not found" };
  }

  const template = templateFn(options.params as any);

  return sendEmail({
    to: options.to,
    toName: options.toName,
    subject: template.subject,
    text: template.text,
    html: template.html,
    userId: options.userId,
    orderId: options.orderId,
    ticketId: options.ticketId,
    leadId: options.leadId,
    template: templateName,
    inReplyTo: options.inReplyTo,
  });
}

// ===== Health check =====

/**
 * Проверить что SMTP-соединение работает.
 * Использовать в /api/email/health и Docker healthcheck.
 */
export async function isEmailHealthy(): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) return false;

  try {
    await transport.verify();
    return true;
  } catch {
    return false;
  }
}
