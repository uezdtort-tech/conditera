# ПРОМПТ S6B2 — Уведомления, email, тикеты

Этап 6 «Коммуникации» | Блок 2. Зависимости: S6B1 (чаты).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — backend-инженер. Система уведомлений v2: ин-апп лента, email-
отправка (шаблоны), приём входящих писем (безопасно!), тикеты поддержки.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui; без indigo/blue.
- Данные: только Prisma; Route Handlers; safe-fetch для исходящих
  (S2B3); sanitize для входящих HTML (S2B3) — хранить И отображать
  только санитизированное.
- Email: SMTP через env (SMTP_URL), шаблоны — простые HTML-файлы с
  подстановками; DEV-режим: письмо пишется в .outbox/ (файлы) вместо
  отправки (env EMAIL_MODE=outbox|smtp, по умолчанию outbox).
- Процесс: коммит `[S6B2] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/секреты; старый проект — только чтение.

## 3. ЦЕЛЬ БЛОКА
Notification-центр (ин-апп + email), приёмник входящих писем с
SafeHtml-хранением, тикет-система поддержки с привязкой к заказам.

## 4. ШАГИ
1. Модели (миграция): Notification (userId, kind, title, body,
   refType/refId, readAt), InboundEmail (from, subject, sanitizedHtml,
   receivedAt, status), Ticket (userId, orderId?, status open/pending/
   closed, subject), TicketMessage (ticketId, authorId, body, isStaff).
2. src/lib/notifications/send.ts: уведомить пользователя — ин-апп
   запись + email (по матрице «событие → каналы», конфиг в
   site_settings); вызовы: заказ оплачен/статус изменился (S4B1/S4B2
   подключат), бонус начислен (S4B3), тикет отвечает staff, новое
   сообщение в чате (S6B1 дублирует ин-аппом если offline).
3. Email: src/lib/email/mailer.ts — outbox/smtp режимы; шаблоны в
   src/lib/email/templates/{order-paid,order-status,bonus,ticket-reply}
   .ts (простые функции → HTML); инъекции: все пользовательские
   значения экранируются; письма НЕ содержат внешних скриптов.
4. Приёмник входящих: POST /api/email/inbound (CSRF-whitelist +
   secret-гейт X-Inbound-Secret из env для будущей интеграции почты):
   сохранение subject/from + SANITIZE html сразу при сохранении
   (хранить только sanitizedHtml — закрыть вектор D4 у истока);
   админ-список связывается с S5B3 (/admin/email).
5. Тикеты: POST /api/tickets (пользователь, CSRF) — создание (subject,
   тело plain, orderId опц.); диалог: GET/POST /api/tickets/:id[/reply]
   (участник или staff); статусы: пользователь закрывает; support
   отвечает (S5B3 UI уже есть — связать); метрика ticket_created.
6. UI: /account/notifications — лента (unread-бейдж в шапке, кнопка
   «прочитать всё», CSRF); /support — форма тикета + мои тикеты
   (публичная страница для гостей: только контакты, без тикетов);
   ин-апп уведомления при наступлении событий — тосты для online.
7. Крон-хуки: reminder о неоплаченном заказе (payment-reminders) —
   функция для реестра S8B1.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- api/email/inbound — контракт приёма (но sanitize при приёме!);
- email-шаблоны старого проекта — тональность и состав полей;
- tickets-API — статусная модель.

## 6. ЗАПРЕТЫ
- Хранить сырой HTML входящих писем — ЗАПРЕЩЕНО (только sanitized).
- dangerouslySetInnerHTML вне SafeHtml — запрещено.
- Не отправлять реальные письма локально (EMAIL_MODE=outbox).

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] Событие заказа генерирует Notification + письмо в .outbox;
- [ ] inbound: письмо с <script> сохраняется санитизированным (проверка
      в БД), админ-просмотр безопасен;
- [ ] Тикет: создать → ответ support → статус closed; уведомления
      пришли; метрика ticket_created отправлена (лог);
- [ ] unread-бейдж шапки корректен; tsc 0; lint 0; коммит [S6B2];
      worklog.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl: создать тикет → reply admin → notifications у пользователя;
- agent-browser: лента, тосты, тикет-диалог; XSS-проба письма.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S6B2]; worklog (события→каналы, шаблоны).
- Отчёт: матрица уведомлений, как проверять письма локально.
