/**
 * Email-уведомления кондитеру при модерации.
 *
 * Шлёт через notifications.ts → deliverEmail:
 *  - approved → "Ваш профиль подтверждён!"
 *  - rejected → "Профиль отклонён" с причиной
 *  - needs_revision → "Запрошены правки" с инструкцией
 *
 * Шаблоны: HTML + plain text.
 *
 * В dev-режиме (без SMTP_URL) — логируется в консоль.
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin.
 *   • Если у кондитера нет email — логируем warn и выходим.
 *   • Любые ошибки отправки email логируются, но НЕ бросают исключение —
 *     модерация не должна блокироваться сбоем SMTP.
 */

import { supabaseAdmin } from "./supabase/admin";

interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

interface SupabaseError {
  message: string;
}

interface ConfectionerRow {
  business_name: string;
  user_id: string;
}

interface UserEmailRow {
  email: string | null;
}

function templateApproved(businessName: string): EmailTemplate {
  return {
    subject: "✅ Ваш профиль кондитера подтверждён — Кондитера",
    text: `Здравствуйте!

Ваш профиль «${businessName}» подтверждён администратором.

Теперь вам доступно:
  • Публикация товаров в каталоге
  • Принятие заказов от покупателей
  • Запрос выплат на банковскую карту
  • Участие в акциях и промо

Желаем успешных продаж!
Команда «Уездного кондитера»
https://conditera.ru`,
    html: `
<div style="font-family:Georgia,serif;max-width:600px;margin:auto;padding:24px;background:#fdfbf7">
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e7d9c0">
    <h1 style="color:#7c2d12;margin:0 0 16px;font-style:italic">Ваш профиль подтверждён!</h1>
    <p style="font-size:16px;line-height:1.6;color:#444">Здравствуйте!</p>
    <p style="font-size:16px;line-height:1.6;color:#444">
      Ваш профиль кондитера <strong>«${businessName}»</strong> прошёл модерацию и подтверждён администратором.
    </p>
    <p style="font-size:16px;line-height:1.6;color:#444">Теперь вам доступно:</p>
    <ul style="font-size:16px;line-height:1.8;color:#444;padding-left:24px">
      <li>📖 Публикация товаров в каталоге</li>
      <li>✅ Принятие заказов от покупателей</li>
      <li>💰 Запрос выплат на банковскую карту</li>
      <li>🎁 Участие в акциях и промо</li>
    </ul>
    <div style="text-align:center;margin:32px 0">
      <a href="https://conditera.ru/dashboard" style="background:#7c2d12;color:#fff;padding:12px 32px;text-decoration:none;border-radius:8px;font-weight:bold">
        Перейти в кабинет
      </a>
    </div>
    <p style="font-size:14px;color:#666;border-top:1px solid #eee;padding-top:16px">
      Желаем успешных продаж!<br>
      Команда «Уездного кондитера»
    </p>
  </div>
</div>`,
  };
}

function templateRejected(businessName: string, reason: string): EmailTemplate {
  return {
    subject: "❌ Профиль кондитера отклонён — Кондитера",
    text: `Здравствуйте!

К сожалению, ваш профиль «${businessName}» не прошёл модерацию.

Причина:
${reason}

Вы можете исправить профиль и отправить его на повторную модерацию:
1. Войдите в кабинет кондитера
2. Внесите правки в профиль
3. Нажмите «Отправить на повторную модерацию»

Если у вас есть вопросы — ответьте на это письмо или напишите в чат поддержки.

Команда «Уездного кондитера»`,
    html: `
<div style="font-family:Georgia,serif;max-width:600px;margin:auto;padding:24px;background:#fdfbf7">
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #f3c4c4">
    <h1 style="color:#991b1b;margin:0 0 16px;font-style:italic">Профиль отклонён</h1>
    <p style="font-size:16px;line-height:1.6;color:#444">Здравствуйте!</p>
    <p style="font-size:16px;line-height:1.6;color:#444">
      К сожалению, ваш профиль кондитера <strong>«${businessName}»</strong> не прошёл модерацию.
    </p>
    <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;margin:24px 0;border-radius:4px">
      <strong style="color:#991b1b">Причина:</strong>
      <p style="margin:8px 0 0;color:#444">${reason}</p>
    </div>
    <p style="font-size:16px;line-height:1.6;color:#444">
      Вы можете исправить профиль и отправить его на повторную модерацию:
    </p>
    <ol style="font-size:16px;line-height:1.8;color:#444;padding-left:24px">
      <li>Войдите в кабинет кондитера</li>
      <li>Внесите правки в профиль</li>
      <li>Нажмите «Отправить на повторную модерацию»</li>
    </ol>
    <p style="font-size:14px;color:#666;border-top:1px solid #eee;padding-top:16px">
      Команда «Уездного кондитера»
    </p>
  </div>
</div>`,
  };
}

function templateNeedsRevision(businessName: string, reason: string): EmailTemplate {
  return {
    subject: "✏️ Запрошены правки профиля — Кондитера",
    text: `Здравствуйте!

Администратор запросил правки в вашем профиле «${businessName}».

Что нужно исправить:
${reason}

После внесения правок — отправьте профиль на повторную модерацию.

Команда «Уездного кондитера»`,
    html: `
<div style="font-family:Georgia,serif;max-width:600px;margin:auto;padding:24px;background:#fdfbf7">
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #c4d7f3">
    <h1 style="color:#1e40af;margin:0 0 16px;font-style:italic">Запрошены правки</h1>
    <p style="font-size:16px;line-height:1.6;color:#444">Здравствуйте!</p>
    <p style="font-size:16px;line-height:1.6;color:#444">
      Администратор запросил правки в вашем профиле <strong>«${businessName}»</strong>.
    </p>
    <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:16px;margin:24px 0;border-radius:4px">
      <strong style="color:#1e40af">Что нужно исправить:</strong>
      <p style="margin:8px 0 0;color:#444">${reason}</p>
    </div>
    <p style="font-size:16px;line-height:1.6;color:#444">
      После внесения правок — отправьте профиль на повторную модерацию.
    </p>
    <p style="font-size:14px;color:#666;border-top:1px solid #eee;padding-top:16px">
      Команда «Уездного кондитера»
    </p>
  </div>
</div>`,
  };
}

/**
 * Отправить email-уведомление кондитеру при смене статуса модерации.
 */
export async function sendConfectionerVerificationEmail(
  confectionerId: string,
  newStatus: "approved" | "rejected" | "needs_revision",
  reason?: string | null
): Promise<void> {
  try {
    // Загружаем кондитера для получения business_name и user_id
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("business_name, user_id")
      .eq("id", confectionerId)
      .maybeSingle() as { data: ConfectionerRow | null; error: SupabaseError | null };

    if (confErr) {
      console.error("[email:confectioner] lookup failed:", confErr.message);
      return;
    }
    if (!conf) {
      console.warn("[email:confectioner] confectioner not found:", confectionerId);
      return;
    }

    // Загружаем email пользователя
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", conf.user_id)
      .maybeSingle() as { data: UserEmailRow | null; error: SupabaseError | null };

    if (userErr) {
      console.error("[email:confectioner] user lookup failed:", userErr.message);
      return;
    }
    if (!userRow?.email) {
      console.warn("[email:confectioner] user has no email:", conf.user_id);
      return;
    }

    const userEmail = userRow.email;
    const businessName = conf.business_name || "Кондитер";

    let template: EmailTemplate;
    if (newStatus === "approved") {
      template = templateApproved(businessName);
    } else if (newStatus === "rejected") {
      template = templateRejected(businessName, reason || "причина не указана");
    } else {
      template = templateNeedsRevision(businessName, reason || "уточните детали");
    }

    console.info(`[email:confectioner] → ${userEmail} subject="${template.subject}"`);

    if (!process.env.SMTP_URL) {
      // Dev-режим — выводим в консоль
      console.info(`[email:confectioner] DEV MODE — would send:`);
      console.info(`  To: ${userEmail}`);
      console.info(`  Subject: ${template.subject}`);
      console.info(`  Body: ${template.text.slice(0, 200)}...`);
      return;
    }

    // Prod — реальная отправка через nodemailer
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport(process.env.SMTP_URL);
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "Кондитера <noreply@conditera.ru>",
      to: userEmail,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    console.info(`[email:confectioner] ✓ sent to ${userEmail}`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[email:confectioner] Failed:", errMsg);
    // Non-fatal — модерация не должна блокироваться сбоем SMTP.
  }
}
