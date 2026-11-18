# ПРОМПТ S4B2 — YooKassa: платежи, webhook, ledger

Этап 4 «Деньги» | Блок 2. Зависимости: S4B1 (заказы), S2B3 (safe-fetch).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — backend-инженер платёжных систем. Ты подключаешь YooKassa v2 с
идемпотентностью, подписями и ЕДИНЫМ ledger-журналом движений денег
(закрыть D10: в старом проекте ledger 0038 так и не был влит).

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Данные: только Prisma. Backend: только Route Handlers. CSRF — для
  пользовательских POST; webhook — whitelist CSRF + подпись.
- Безопасность: секреты YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY только
  env; не печатать .env*; исходящие — только safe-fetch (таймаут,
  SSRF-guard). Тестовый контур YooKassa: MOCK-режим по env
  PAYMENTS_MODE=mock|yookassa (по умолчанию mock — без боевых вызовов).
- Процесс: коммит `[S4B2] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/боевые ключи; старый проект — только чтение.

## 3. ЦЕЛЬ БЛОКА
Оплата заказа (создание платежа, редирект, webhook, подтверждение),
ledger-журнал всех движений, идемпотентность на всём денежном пути.

## 4. ШАГИ
1. Модель Payment (миграция): id, orderId, provider ("mock"|"yookassa"),
   providerPaymentId, amount, status (pending|waiting_for_capture|
   succeeded|canceled), idempotencyKey (unique), rawPayload (json),
   createdAt/updatedAt.
2. Ledger (S1B2 создал balance_ledger) — правила:
   - КАЖДОЕ движение денег (оплата, возврат, бонус, выплата, hold,
     release) создаёт запись ledger с balanceAfter; записи только
     в транзакции с изменением баланса/статуса;
   - ЕДИНСТВЕННАЯ точка записи: src/lib/payments/ledger.ts
     (функции ledgerEntry(...) — больше нигде INSERT в balance_ledger).
3. Создание платежа: POST /api/orders/:id/pay (auth, CSRF, rate-limit):
   - mock: мгновенно succeeded (для dev-пути);
   - yookassa: safe-fetch POST https://api.yookassa.ru/v3/payments
     (Basic shopId:secretKey, Idempotence-Key UUID, amount, capture,
     confirmation redirect, metadata.orderId); вернуть confirmationUrl.
4. Webhook POST /api/webhooks/yookassa (CSRF-whitelist):
   - проверка источника: только по IP-диапазонам YooKassa (env-
     конфиг) + верификация тела (контракт v3);
   - идемпотентность: если providerPaymentId уже обработан в том же
     статусе → 200 без повторных действий;
   - обработка payment.succeeded → транзакция: Payment=succeeded,
     Order=paid, ledger: payment-запись; payment.canceled →
     Order=pending_payment→cancelled (если не в работе) + ledger.
5. Возвраты: POST /api/admin/payments/:id/refund (admin, CSRF):
   yookassa refunds API (mock: сразу), ledger refund-запись,
   Order=refunded.
6. Метрика server-цель payment_succeeded / refund_processed — из
   webhook-обработчика (через src/lib/analytics/metrika-server.ts,
   S3B3), fail-open.
7. UI: /checkout/success?orderId= — подтверждение (статус заказа
   подтягивается GET /api/orders/:id — только владелец);
   /account/orders — кнопка «Оплатить» для pending_payment.
8. Документация docs/PAYMENTS.md v2: поток оплаты, идемпотентность,
   правила ledger, что проверить при подключении боевых ключей.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- api/payment/webhook/route.ts — контракт обработки событий и
  идемпотентный паттерн (адаптировать на Prisma-транзакции);
- уроки KNOWN_LIMITATIONS 1–5: ledger обязателен, боевые ключи не
  проверены — поэтому MOCK-режим по умолчанию.

## 6. ЗАПРЕТЫ
- Боевые ключи НЕ подключать (только env-шаблон в .env.example).
- Записи в balance_ledger вне ledger.ts — запрещены.
- Не доверять webhook-телу без проверки источника.

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] mock-оплата: заказ → paid, ledger-запись с balanceAfter;
- [ ] повторный webhook с тем же event → 200, без дублей в ledger;
- [ ] refund → Order=refunded + ledger refund;
- [ ] webhook без валидного источника → 403;
- [ ] tsc 0, lint 0; коммит [S4B2]; worklog; docs/PAYMENTS.md.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl-цикл: создать заказ (S4B1) → pay (mock) → статус paid →
  повторный webhook → проверить отсутствие дублей;
- agent-browser: путь до /checkout/success, статус обновился.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S4B2]; docs/PAYMENTS.md; worklog.
- Отчёт: поток денег, где ledger, что нужно владельцу для боевых
  ключей (чек-лист YooKassa).
