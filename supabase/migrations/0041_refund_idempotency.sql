-- 0041_refund_idempotency.sql
--
-- Идемпотентность заявок на возврат (спецификация «Payments/Refund», п. 9–10):
--  1) Повторный POST /api/payment/refund с тем же Idempotency-Key от того же
--     пользователя НЕ создаёт вторую заявку — API возвращает существующую.
--     Механизм тот же, что для chat_messages в 0040: частичный уникальный
--     индекс + обработка 23505 на стороне API.
--  2) Защита от двойного клика в UI без ключа: у одного платежа может быть
--     только ОДНА открытая заявка (status='requested'). Повторная заявка
--     возможна после rejection/завершения текущей.
--  3) Ускоряющие индексы для GET /api/payment/refund (owner-список и
--     админ-очередь открытых заявок).

ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN public.refunds.idempotency_key IS
  'Ключ идемпотентности клиента (Idempotency-Key): повторный запрос возвращает ту же заявку';

-- (initiated_by, idempotency_key): уникальность ключа в рамках пользователя
CREATE UNIQUE INDEX IF NOT EXISTS uq_refunds_user_idempotency
  ON public.refunds(initiated_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Одна открытая заявка (requested) на платёж: защита от двойного клика
CREATE UNIQUE INDEX IF NOT EXISTS uq_refunds_one_requested_per_payment
  ON public.refunds(payment_id)
  WHERE status = 'requested';

-- GET-пути: возвраты по заказам пользователя и открытая очередь для админа
CREATE INDEX IF NOT EXISTS idx_refunds_initiated_by_created
  ON public.refunds(initiated_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_open_queue
  ON public.refunds(created_at DESC)
  WHERE status IN ('requested', 'processing');
