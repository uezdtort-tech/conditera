-- 0038_ledger_reconciliation.sql — PAY-2 (ledger-контур)
--
-- Проблема (аудит PAY-2): таблица confectioner_transactions существует с 0017
-- (schema: id TEXT PK, "confectionerId", "type", "amount", "description",
-- "orderId", "balanceAfter", "metadata", "createdAt"), но НЕ ПИШЕТСЯ НИ ОДНИМ
-- контуром: ни начисление эскроу, ни резерв выплаты, ни возврат резерва, ни
-- компенсация не оставляют журнальной записи. Сверка баланса была возможна
-- только ручной сверкой по orders/payout_requests; crash-window'ы между шагами
-- (insert→deduct→reserve, reject CAS→refund) не оставляли следов.
--
-- Решение: журнал пишется В ТОЙ ЖЕ транзакции, что и движение баланса:
--   • release_escrow_order (0037) — тело заменено (та же сигнатура): после
--     начисления INSERT 'escrow_release' с orderId. Сигнатура не менялась —
--     гранты 0037 остаются в силе.
--   • add/deduct_confectioner_balance — НОВЫЕ ОВЕРЛОАДЫ с опциональными
--     p_type/p_metadata (DEFAULT: 'credit'/'debit', NULL). Старые 3-арг
--     сигнатуры продолжают работать (без ledger-записи — общие типы
--     credit/debit пишутся ТОЛЬКО оверлоадами; старые вызовы не журналируются,
--     дрейф ловит reconcile-money). ВАЖНО: новый оверлоад получает дефолтные
--     PUBLIC EXECUTE — ниже гранты перевыпускаются по proname для ВСЕХ
--     сигнатур (как 0036/0037).
--
-- 2) FK orders.payout_request_id → payout_requests(id) NOT VALID: осиротевшие
--    ссылки (заявка удалена — резерв «повис») для новых строк невозможны.
--    NOT VALID: существующие строки не проверяются (легаси), новые — да.
-- 3) FK confectioner_transactions."confectionerId" → confectioners(id) NOT VALID
--    + индекс по ("confectionerId","createdAt") для выборок журнала.
-- 4) Комментарий payout_requests.method обновлён (PAY-2 унифицировал enum
--    в коде: card | sbp | bank_account; 'invoice' исключён из выплат).
--
-- Типы ledger-записей (convention, 'amount' — знаковое движение баланса):
--   escrow_release            (+) начисление эскроу-кроном, orderId заполнен
--   payout_reserve            (−) резерв под заявку /api/payouts/request
--   payout_reject_refund      (+) возврат резерва при admin reject
--   payout_reserve_compensation (+) компенсация при CAS-гонке резерва
--   opening_balance           (+) стартовая запись сидирования (reconcile-money --seed-opening)
--   credit / debit            (±) общие типы оверлоадов по умолчанию
--
-- Порядок применения: СТРОГО после 0037 (release_escrow_order должен
-- существовать для CREATE OR REPLACE; DO-блок с проверкой — 0038 не падает,
-- если 0037 не применена, но эскроу-ledger заработает только после 0037).
-- One-shot валидация: bun scripts/verify-ledger-0038-pglite.ts

-- === 1. FK: orders.payout_request_id → payout_requests(id) ===
DO $pay2$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_orders_payout_request'
       AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT fk_orders_payout_request
      FOREIGN KEY (payout_request_id) REFERENCES public.payout_requests(id)
      NOT VALID;
  END IF;
END
$pay2$;

COMMENT ON CONSTRAINT fk_orders_payout_request ON public.orders IS
  'PAY-2: резерв выплаты жёстко связан с заявкой. NOT VALID — существующие строки не проверялись; VALIDATE CONSTRAINT возможен отдельным окном после ops-сверки осиротевших ссылок.';

-- === 2. FK + индекс: confectioner_transactions ===
DO $pay2$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_conf_transactions_confectioner'
       AND conrelid = 'public.confectioner_transactions'::regclass
  ) THEN
    ALTER TABLE public.confectioner_transactions
      ADD CONSTRAINT fk_conf_transactions_confectioner
      FOREIGN KEY ("confectionerId") REFERENCES public.confectioners(id)
      NOT VALID;
  END IF;
END
$pay2$;

CREATE INDEX IF NOT EXISTS idx_conf_transactions_confectioner_created
  ON public.confectioner_transactions ("confectionerId", "createdAt" DESC);

-- === 3. add_confectioner_balance — оверлоад с ledger-записью ===
CREATE OR REPLACE FUNCTION public.add_confectioner_balance(
  p_confectioner_id TEXT,
  p_amount INTEGER,
  p_type TEXT DEFAULT 'credit',
  p_order_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pay2$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'add amount must be positive';
  END IF;

  UPDATE public.confectioners
     SET balance = COALESCE(balance, 0) + p_amount
   WHERE id = p_confectioner_id
  RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'confectioner not found: %', p_confectioner_id;
  END IF;

  -- PAY-2: журнал движения — та же транзакция, что и само движение.
  -- Сбой INSERT откатывает и начисление (атомарность ledger).
  INSERT INTO public.confectioner_transactions
    ("id", "confectionerId", "type", "amount", "orderId", "balanceAfter", "metadata")
  VALUES
    ('txn_' || replace(gen_random_uuid()::text, '-', ''),
     p_confectioner_id, p_type, p_amount, p_order_id, v_new_balance, p_metadata);

  RETURN v_new_balance;
END
$pay2$;

-- === 4. deduct_confectioner_balance — оверлоад с ledger-записью ===
-- Семантика 0013 сохранена: FOR UPDATE, проверка достаточности, positive guard.
CREATE OR REPLACE FUNCTION public.deduct_confectioner_balance(
  p_confectioner_id TEXT,
  p_amount INTEGER,
  p_type TEXT DEFAULT 'debit',
  p_order_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pay2$
DECLARE
  v_new_balance INTEGER;
  v_current INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'deduct amount must be positive';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_current
    FROM public.confectioners
   WHERE id = p_confectioner_id
   FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'confectioner not found: %', p_confectioner_id;
  END IF;

  IF v_current < p_amount THEN
    RAISE EXCEPTION 'insufficient balance: has %, needs %', v_current, p_amount;
  END IF;

  UPDATE public.confectioners
     SET balance = v_current - p_amount
   WHERE id = p_confectioner_id
  RETURNING balance INTO v_new_balance;

  -- PAY-2: журнал движения — та же транзакция, что и само движение.
  INSERT INTO public.confectioner_transactions
    ("id", "confectionerId", "type", "amount", "orderId", "balanceAfter", "metadata")
  VALUES
    ('txn_' || replace(gen_random_uuid()::text, '-', ''),
     p_confectioner_id, p_type, -p_amount, p_order_id, v_new_balance, p_metadata);

  RETURN v_new_balance;
END
$pay2$;

-- === 5. release_escrow_order — тело с ledger-записью (та же сигнатура) ===
-- Выполняется только если 0037 применена (функция существует). Семантика
-- claim'а сохранена: RETURNING...INTO при 0 строк даёт NULL — проверка IS NULL
-- (фикс pay3b), RAISE откатывает ВСЁ вместе с ledger-записью.
DO $pay2$
DECLARE
  v_body TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'release_escrow_order'
  ) THEN
    v_body := $fn$
CREATE OR REPLACE FUNCTION public.release_escrow_order(
  p_order_id UUID,
  p_conf_id TEXT,
  p_payout INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pay2fn$
DECLARE
  v_claimed INTEGER;
  v_new_balance INTEGER;
BEGIN
  IF p_payout IS NULL OR p_payout < 0 THEN
    RAISE EXCEPTION 'payout must be >= 0';
  END IF;

  UPDATE public.orders
     SET escrow_released_at = now(),
         payment_status = 'released'
   WHERE id = p_order_id
     AND payment_status = 'escrow'
     AND escrow_released_at IS NULL
  RETURNING 1 INTO v_claimed;

  IF v_claimed IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.confectioners
     SET balance = COALESCE(balance, 0) + p_payout,
         "totalEarnings" = COALESCE("totalEarnings", 0) + p_payout
   WHERE id = p_conf_id
  RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'confectioner not found: %', p_conf_id;
  END IF;

  -- PAY-2: журнал начисления — orderId заполнен (escrow_release).
  INSERT INTO public.confectioner_transactions
    ("id", "confectionerId", "type", "amount", "orderId", "balanceAfter", "metadata")
  VALUES
    ('txn_' || replace(gen_random_uuid()::text, '-', ''),
     p_conf_id, 'escrow_release', p_payout, p_order_id::TEXT, v_new_balance,
     jsonb_build_object('totalEarnings_delta', p_payout));

  RETURN 1;
END
$pay2fn$;
BEGIN
  EXECUTE v_body;
END;
    ELSE
      RAISE NOTICE 'release_escrow_order не существует (0037 не применена) — эскроу-ledger пропущен';
    END IF;
END
$pay2$;

-- === 6. Гранты: все сигнатуры money-RPC — только service_role ===
-- Оверлоады получают дефолтные PUBLIC EXECUTE — перевыпускаем по proname
-- (сигнатурно-независимо, как 0036).
DO $pay2$
DECLARE
  fn record;
  fname TEXT;
BEGIN
  FOREACH fname IN ARRAY ARRAY[
    'add_confectioner_balance',
    'deduct_confectioner_balance',
    'release_escrow_order'
  ] LOOP
    FOR fn IN
      SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = fname
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', fn.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn.sig);
    END LOOP;
  END LOOP;
END
$pay2$;

-- === 7. Комментарии ===
COMMENT ON COLUMN public.payout_requests.method IS
  'PAY-2 (унификация): card | sbp | bank_account — единый enum в /api/payouts/request и /api/admin/payouts. invoice исключён (без payout-провайдера способ подтверждает админ на approve/complete).';

COMMENT ON TABLE public.confectioner_transactions IS
  'PAY-2: журнал движений баланса кондитера. Пишется В ТОЙ ЖЕ транзакции, что и движение (add/deduct_confectioner_balance, release_escrow_order). amount — знаковое движение; balanceAfter — баланс после движения. Типы: escrow_release | payout_reserve | payout_reject_refund | payout_reserve_compensation | opening_balance | credit | debit. До 0038 движения не журналировались — сверка только по orders/payout_requests.';
