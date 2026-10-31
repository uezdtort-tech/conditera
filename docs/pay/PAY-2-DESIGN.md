# PAY-2 — журнал финансовых операций и возвратов (проект + реализация)

Статус: **реализовано (код + миграция 0063 + сверка)**, владелец согласовывает перед production.
Автор: Z (главный разработчик). Дата: 2026-11-01.

---

## 1. Текущее состояние (инвентаризация до проектирования)

| Контур | Реализация | Инвариант | Покрытие |
|---|---|---|---|
| Резерв остатка возврата | RPC `reserve_refund` (0035) — один UPDATE с условием | Защита от конкурентных повторных возвратов | ✅ атомарно, строки сериализуются блокировкой |
| Идемпотентность заявок | `refunds.idempotency_key` UNIQUE (initiated_by, key) (0041), `uq_refunds_one_requested_per_payment` | Идемпотентность запросов | ✅ |
| Возврат у провайдера | `lib/yookassa.refundPayment` — детерминированный Idempotence-Key от refund-записи; mock_* в production отклонён | Идемпотентность + нет фиктивного успеха | ✅ |
| Webhook refund.succeeded | `apply_yookassa_refund` (0039): дедуп по refund id, атомарное суммирование `payments.refund_amount`, сверка с GET /refunds/{id} | Нет двойного зачисления/списания | ✅ |
| Webhook payment.succeeded | CAS-гварды + сверка суммы с провайдером + dedupKey-уведомления | Согласованность заказ/платёж | ✅ |
| Журнал КОНДИТЕРА | `confectioner_transactions` (0017) + запись в транзакции движения (0038: escrow_release, payout_reserve, payout_reject_refund, компенсации) + RLS (0039) | Атомарность начислений кондитеру | ✅ |
| Двухступенчатый возврат | покупатель → `requested` (деньги не двигаются); исполнение — ADMIN/SUPER_ADMIN | Разделение ролей | ✅ |

## 2. Подтверждённые пробелы (то, что закрывает PAY-2)

1. **Платформенный журнал клиентских денег отсутствует.** Жизненный цикл
   платежа/возврата (`payment_created → payment_succeeded/canceled →
   refund_requested → refund_sent → refund_confirmed/failed`) не оставляет
   append-only следа. Окно компромисса из PAY-1 (резерв `refund_amount`
   снимается после принятия провайдером; крэш между шагами не оставляет
   следа — код сам помечает: «осознанный компромисс до ledger-учёта (PAY-2)»).
2. **Нет инструмента сверки**: `payments.refund_amount` vs
   `yookassa_refund_events` vs `refunds.status='processed'` — расхождение
   обнаруживается только жалобой.
3. **Отказ провайдера при возврате** не журналируется (refund остаётся
   `approved`, резерв снят — повтор возможен, но следа нет).

## 3. Денежные инварианты PAY-2 и точки реализации

| Инвариант (ТЗ) | Реализация |
|---|---|
| Атомарность денежных изменений | Движения денег — по-прежнему только RPC (reserve_refund/apply_yookassa_refund/release_escrow_order); ledger — append-only БЕЗ движения денег, пишется после факта |
| Идемпотентность запросов и webhook | `financial_ledger.idempotency_key` UNIQUE; вставка `ON CONFLICT DO NOTHING`-семантикой (23505 → успех) |
| Защита от конкурентных повторных возвратов | Без изменений: reserve_refund + idempotency-ключи (0035/0041) |
| Проверка суммы/валюты/владельца/состояния | Без изменений: refund-роут (сумма ≤ остатка, статус succeeded, владелец/admin), webhook-сверка с провайдером |
| Согласованность журнал/заказ/платёж/возврат | Каждая запись ссылается payment_id + order_id + refund_id (где применимо) |
| Сверка и восстановление после частичного сбоя | `scripts/reconcile-payments.ts` (см. §5) |
| Нет двойного списания/зачисления | Ledger не двигает деньги; дедуп по idempotency_key; повторная доставка webhook дедупится и на уровне 0039, и на уровне журнала |
| Не подменять возврат фиктивным успехом | Режимы провайдера разделены: `yookassa` (production), `db-only` (платёж без provider id — легаси/mock-dev, помечен в metadata), mock в production отклонён (lib) |
| Разделение локальный тест / sandbox / production | metadata.mode записи: NODE_ENV + источник; production-сборка требует настроенного провайдера (checkout 503 без него) |

## 4. Схема (миграция 0063, additive — существующие таблицы не меняются)

```sql
financial_ledger (
  id              uuid PK default gen_random_uuid(),
  created_at      timestamptz default now(),
  entry_type      text NOT NULL,      -- payment_created | payment_succeeded | payment_canceled |
                                      -- refund_requested | refund_sent | refund_send_failed |
                                      -- refund_confirmed | adjustment
  amount          numeric NOT NULL,   -- знаковое, РУБЛИ: +платёж платформе, −возврат клиенту
  currency        text NOT NULL DEFAULT 'RUB',
  payment_id      uuid REFERENCES payments(id),
  order_id        uuid,
  refund_id       uuid REFERENCES refunds(id),
  actor_id        uuid,               -- кто инициировал (покупатель/админ/система)
  idempotency_key text UNIQUE,        -- дедуп записей журнала
  metadata        jsonb               -- provider: yookassa|db-only, mode, reason…
)
```

RLS: ENABLE + запрет для anon/authenticated (как confectioner_transactions в 0039);
пишет только service_role (роуты под admin-клиентом).
Индексы: (payment_id), (order_id), (refund_id), (created_at DESC).

Правило записи: **только после факта** (провайдер принял / CAS применил) — журнал
никогда не является причиной движения денег, поэтому частичный сбой = отсутствие
записи, а не ложная запись; восстанавливается повторной доставкой webhook / ретраем.

## 5. Сверка (`scripts/reconcile-payments.ts`)

Проверки (exit 1 при расхождении):
1. На каждый платёж: `payments.refund_amount * 100 == SUM(yookassa_refund_events.amount_kopecks)`.
2. На каждый платёж: `SUM(refunds.amount WHERE status='processed') == payments.refund_amount`.
3. Платежи `succeeded` без ledger-записи `payment_succeeded` (дрейф журнала).
4. Записи `refund_confirmed` без соответствующего события провайдера (подозрение на подделку).

## 6. Что СДЕЛАНО в этой задаче

- 0063_financial_ledger.sql (таблица, RLS, индексы, комментарии).
- `lib/financial-ledger.ts`: `recordFinancialEntry` (идемпотентная вставка),
  `recordFinancialEntrySafe` (fail-safe для non-blocking вызовов).
- Точки записи: checkout (payment_created), webhook (payment_succeeded,
  payment_canceled, refund_confirmed), refund-роут (refund_requested,
  refund_sent, refund_send_failed, refund_confirmed db-only).
- `scripts/reconcile-payments.ts` — сверка (п.5).
- Тесты: идемпотентность вставки, знаковая конвенция, дедуп webhook-записи.

## 7. Что требует владельца

- Подтвердить sign-конвенцию amount (+платёж / −возврат) — текущая: платформа-клиент.
- Решить, кто имеет доступ на чтение журнала (сейчас только service_role; админский UI — отдельная задача).
- Sandbox-провайдер (YooKassa shopId/secret тестового магазина) — не запрашивается в чате; при появлении — прогон сверки на sandbox-платежах.
