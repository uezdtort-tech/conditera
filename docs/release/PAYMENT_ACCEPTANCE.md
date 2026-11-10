# PAYMENT_ACCEPTANCE — YooKassa (Z-v21)

**Дата:** 2026-11-10 · Метод: аудит кода + unit/E2E тесты + verify-скрипты. Реальных денежных операций нет.

## 1. Вердикт

**Код и контракты: PASS (локально). Живой sandbox-цикл: BLOCKED** — требуются реальные sandbox-credentials владельца (`YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` тестового магазина) и регистрация webhook-URL в личном кабинете YooKassa. По критериям ТЗ §19.3 это честный статус: «payment sandbox PASS либо платежи официально исключены» — сейчас ни то, ни другое.

## 2. Что проверено фактически (без провайдера)

| Инвариант ТЗ §9 | Реализация | Проверка |
|---|---|---|
| Сумма платежа = сумме заказа | webhook сверяет копейки: wire ↔ payments.amount ↔ orders.total; mismatch → `skipped:"amount_mismatch"` | unit: `route.test.ts`, `route.http.test.ts` |
| Заказ не становится оплаченным от клиентского redirect | `/checkout/success` только читает статус; единственные писатели paid-статусов: webhook (→`escrow`) и cron escrow-release (→`released`) | grep-аудит писателей + `lifecycle.ts` (CONFIRMED требует `payment_confirmed_or_cash`) |
| Только серверно-подтверждённый платёж | PAY-1: перед применением — re-fetch платежа из API YooKassa, сверка статуса+суммы; сбой API → 500 fail-closed | `verifyEventWithProvider()` route.ts L79–151 + тесты |
| Повторный webhook без двойных эффектов | финально-статусный гейт идемпотентности + CAS `update … .neq("payment_status","escrow")` | `route.test.ts` (succeeded→idempotent), E2E `payment-webhook-idempotency.spec.ts` 12 сценариев |
| Повторный refund без двойного возврата | RPC `apply_yookassa_refund` (0039): `ON CONFLICT (refund_id) DO NOTHING`, атомарное накопление `refund_amount`, flip в `refunded` при полноте; EXECUTE только service_role | миграция 0039 + webhook-тесты |
| Неуспешный платёж / отмена | payment.canceled → orders.status=CANCELLED + history + ledger `payment_canceled` | тесты |
| Неизвестный payment id | 404 (YooKassa повторит доставку); событие без id → 400 | `route.http.test.ts` |
| Изоляция пользователей | маппинг строго по `yookassa_payment_id`; legacy `metadata.orderId` fallback отключён в production | `route.http.test.ts` |
| Верификация подлинности уведомлений | IP-allowlist провайдера (IPv4+IPv6 CIDR) + re-fetch с провайдера (YooKassa не имеет подписи — двухслойная схема) | `verifyWebhook()` L297–443 |
| Prod fail-closed | без кредов: создание платежа 503, webhook 500; `mock_*` ids запрещены в prod | `payment-prod-guard.test.ts` |
| Частичный возврат | поддержан: `refundPayment(amount)` + детерминированный ключ `uezd_konditer:refund:{refundId}`; резерв `reserve_refund` до вызова провайдера | `/api/payment/refund` L327–453 |

Локальные прогоны этой сессии: vitest suites платёжного периметра PASS в общем наборе 1571/1571; E2E-webhook сценарии — в наборе Playwright (частично прогонялись в Z-v20; в Z-v21 среда не позволила полный Playwright-прогон — см. KNOWN_LIMITATIONS).

## 3. Полный жизненный цикл (реализован)

```
checkout → POST /v3/payments (capture:true, Idempotence-Key uezd_konditer:create:{orderId})
         → redirect на hosted-страницу YooKassa
webhook payment.succeeded → re-fetch сверка → payments.status=succeeded, orders.payment_status=escrow
         → ledger payment_succeeded → entitlement (рецепты) → Telegram/Email/n8n (fail-safe)
cron escrow-release → payment_status=released (после выполнения заказа)
refund: запрошен (requested) → админ исполняет → reserve_refund → POST /v3/refunds
        → webhook refund.succeeded → apply_yookassa_refund (dedup) → payments/orders=refunded
        → revoke entitlement → ledger refund_confirmed
```

## 4. Дрейф-риск (вне Next.js-рантайма)

`supabase/functions/yookassa-webhook/index.ts` (Deno Edge Function): IP-проверка — TODO-заглушка, нет сверки сумм, нет идемпотентности, ставит `orders.status='CONFIRMED'` напрямую; `verify_jwt=false` в config.toml. **В рантайм Next.js не входит**, но при деплое functions это слабый дублирующий webhook. Рекомендация владельцу: не деплоить supabase/functions либо удалить/привести к PASS-эталону Next-версии до релиза.

## 5. План sandbox-приёмки (после получения credentials владельцем)

1. Заполнить `YOOKASSA_SHOP_ID`/`YOOKASSA_SECRET_KEY` тестового магазина в staging env.
2. Зарегистрировать webhook `https://<staging>/api/payment/webhook` в кабинете.
3. Прогнать ТЗ §9 п.1–18: создание→оплата тестовой картой→webhook→escrow; повторный webhook; отмена; полный/частичный refund; повторный refund; несоответствие суммы (искусственно); неизвестный id.
4. Зафиксировать evidence в этот документ (даты, ID транзакций sandbox, результаты).

Статус после шагов 1–4 может быть повышен до PASS.
