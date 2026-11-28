-- 0089_financial_ledger.sql — PAY-2: платформенный журнал финансовых операций.
--
-- Проблема (docs/pay/PAY-2-DESIGN.md §2): жизненный цикл платежа/возврата
-- (payment_created → succeeded/canceled → refund_requested → refund_sent →
-- refund_confirmed/failed) не оставлял append-only следа. Окно компромисса
-- PAY-1 (временный резерв refund_amount, снимаемый после принятия провайдером)
-- при крэше не оставлял следа; сверка возможна только вручную по трём таблицам.
--
-- Решение: append-only журнал БЕЗ движения денег (деньги двигают только RPC
-- reserve_refund/apply_yookassa_refund/release_escrow_order — неизменно).
-- Каждая запись — ПОСЛЕ факта (идемпотентно, дедуп по idempotency_key).
--
-- Инварианты:
--   • только service_role пишет/читает (RLS, как confectioner_transactions в 0039);
--   • idempotency_key UNIQUE — повторная вставка записи НЕ создаёт дубль;
--   • amount знаковый в РУБЛЯХ: +платёж платформе, −возврат клиенту;
--   • payment_id/order_id/refund_id — связи для сверки журнала с деньгами.
--
-- Идемпотентность миграции: полная (IF NOT EXISTS / DO-гварды).

-- ===== 1. Таблица =====
CREATE TABLE IF NOT EXISTS public.financial_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  entry_type      text NOT NULL,
  amount          numeric NOT NULL,
  currency        text NOT NULL DEFAULT 'RUB',
  payment_id      uuid REFERENCES public.payments(id),
  order_id        uuid,
  refund_id       uuid REFERENCES public.refunds(id),
  actor_id        uuid,
  idempotency_key text,
  metadata        jsonb
);

COMMENT ON TABLE public.financial_ledger IS
  'PAY-2: append-only журнал финансовых операций (деньги НЕ двигает; пишется после факта). Знак amount: + поступление платформе, − возврат клиенту. Рубили.';

COMMENT ON COLUMN public.financial_ledger.entry_type IS
  'payment_created | payment_succeeded | payment_canceled | refund_requested | refund_sent | refund_send_failed | refund_confirmed | adjustment';

COMMENT ON COLUMN public.financial_ledger.idempotency_key IS
  'Дедуп записей журнала: повторная вставка с тем же ключом — no-op (23505 → успех).';

-- Ограничение типов записей (documented contract)
DO $pay2$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_ledger_entry_type_check'
  ) THEN
    ALTER TABLE public.financial_ledger ADD CONSTRAINT financial_ledger_entry_type_check
      CHECK (entry_type IN (
        'payment_created', 'payment_succeeded', 'payment_canceled',
        'refund_requested', 'refund_sent', 'refund_send_failed',
        'refund_confirmed', 'adjustment'
      ));
  END IF;
END
$pay2$;

-- ===== 2. Индексы =====
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_ledger_idem_key
  ON public.financial_ledger (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_ledger_payment ON public.financial_ledger (payment_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_order ON public.financial_ledger (order_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_refund ON public.financial_ledger (refund_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_created ON public.financial_ledger (created_at DESC);

-- ===== 3. RLS: только service_role (паттерн 0039) =====
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.financial_ledger FROM anon, authenticated;

DO $pay2$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_ledger'
      AND policyname = 'financial_ledger_service_only'
  ) THEN
    CREATE POLICY financial_ledger_service_only ON public.financial_ledger
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$pay2$;

-- ===== 4. RPC-хелпер идемпотентной записи (опционально для SQL-путей) =====
CREATE OR REPLACE FUNCTION public.record_financial_entry(
  p_entry_type TEXT,
  p_amount NUMERIC,
  p_currency TEXT DEFAULT 'RUB',
  p_payment_id UUID DEFAULT NULL,
  p_order_id UUID DEFAULT NULL,
  p_refund_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.financial_ledger
      WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id; -- идемпотентный повтор
    END IF;
  END IF;

  INSERT INTO public.financial_ledger
    (entry_type, amount, currency, payment_id, order_id, refund_id, actor_id, idempotency_key, metadata)
  VALUES
    (p_entry_type, p_amount, p_currency, p_payment_id, p_order_id, p_refund_id, p_actor_id, p_idempotency_key, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_financial_entry FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_financial_entry TO service_role;
