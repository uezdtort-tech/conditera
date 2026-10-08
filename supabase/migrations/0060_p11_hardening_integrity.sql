-- ============================================================================
-- 0060_p11_hardening_integrity.sql — P1.1 Production Hardening
-- ============================================================================
-- Целостность на уровне БД для контрактов, которые раньше держались только
-- на прикладном уровне (гонки/повторы ломали инварианты):
--
--   1. domain_events.dedup_key + UNIQUE — стабильный idempotency key события
--      (P1.1 §3): повторная обработка одного события не создаёт вторую строку.
--      Частичный индекс (WHERE dedup_key IS NOT NULL) — статусные события
--      (order.status_changed и пр.) легитимно пишутся многократно.
--
--   2. notifications: UNIQUE (user_id, channel, metadata->>'dedup_key') —
--      повторная обработка события (retry webhook / повторная эмиссия) не
--      создаёт второй notification (P1.1 §3). Дедуп-ключ пишется в metadata.
--
--   3. product_reviews: UNIQUE (order_id) WHERE order_id IS NOT NULL —
--      контракт «1 заказ = 1 отзыв» (ТЗ P1 §15, P1.1 §13) закреплён в БД,
--      а не только 409-проверкой API (гонка двух POST больше не даёт дубль).
--
--   4. orders: UNIQUE (user_id, metadata->>'idempotency_key') — race двух
--      параллельных POST /api/checkout с одним Idempotency-Key больше не
--      создаёт два заказа (P1.1 §8): select-before-insert закрывается БД.
--
--   5. fillings: UNIQUE (name) — идемпотентность seed_fillings.sql
--      (P1.1 §4): повторный прогон сидов больше не добавляет +45 дублей.
--
--   6. chat_channels: пересоздание индекса 0058 с `deleted_at IS NULL` —
--      софт-удалённая order-комната больше не навсегда блокирует создание
--      новой для того же заказа (P1.1 §12).
-- ============================================================================

-- 1. domain_events — idempotency key события
ALTER TABLE public.domain_events ADD COLUMN IF NOT EXISTS dedup_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_events_dedup
  ON public.domain_events (dedup_key)
  WHERE dedup_key IS NOT NULL;
COMMENT ON COLUMN public.domain_events.dedup_key IS
  'P1.1: стабильный idempotency key (например order-created:<orderId>) — повторная обработка события не создаёт дубль. NULL = статусные события, пишутся многократно.';

-- 2. notifications — дедуп повторной обработки события
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedup
  ON public.notifications (user_id, channel, (metadata->>'dedup_key'))
  WHERE metadata->>'dedup_key' IS NOT NULL;

-- 3. product_reviews — один отзыв на заказ (0057 добавила order_id без UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_reviews_order
  ON public.product_reviews (order_id)
  WHERE order_id IS NOT NULL;

-- 4. orders — Idempotency-Key checkout на уровне БД
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idempotency
  ON public.orders (user_id, (metadata->>'idempotency_key'))
  WHERE metadata->>'idempotency_key' IS NOT NULL;

-- 5. fillings — уникальность имени (сейф для сидов; дублей на момент
--    миграции нет — проверено; FK на fillings отсутствуют)
CREATE UNIQUE INDEX IF NOT EXISTS uq_fillings_name
  ON public.fillings (name);

-- 6. chat_channels — 0058 без учёта софт-удаления
DROP INDEX IF EXISTS public.uq_chat_channels_order_id;
CREATE UNIQUE INDEX uq_chat_channels_order_id
  ON public.chat_channels (order_id)
  WHERE order_id IS NOT NULL AND deleted_at IS NULL;
