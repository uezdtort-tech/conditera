-- 0036_payout_integrity.sql — PAY-3 (аудит контура выплат @ 3eb6066)
--
-- 1) orders.payout_reserved_at — момент резервирования заказа под payout-заявку.
--    Закрывает P0-1 (двойная выплата одного батча): /api/payouts/request
--    резервирует каждый заказ CAS-апдейтом (payout_reserved_at IS NULL →
--    NOT NULL). Конкурентные/повторные заявки физически не могут включить
--    один и тот же заказ дважды; итоговая выплата — по-прежнему
--    payout_transferred_at (admin complete), семантика колонки не меняется.
-- 2) RPC add_confectioner_balance — атомарный инкремент баланса (пара к
--    deduct_confectioner_balance 0013): возврат резерва при reject и
--    компенсация при частичном сбое резерва. Однострочный UPDATE —
--    атомарен, без read-then-write.
-- 3) Гранты/RLS (разделение полномочий):
--    • money/bonus-RPC (add/deduct_confectioner_balance, add/deduct_bonus_balance)
--      — EXECUTE только service_role. 0013 создал их с дефолтным PUBLIC EXECUTE;
--      deduct_confectioner_balance закрыт в 0034, bonus-пара и новый add — здесь.
--    • RLS payout_requests: политика payouts_update_admin без INSPECTOR
--      (инспектор — читатель; approve/complete/reject — только ADMIN/SUPER_ADMIN).
-- 4) Комментарии стейт-машины payout_requests (PAY-3):
--    pending → approved → paid | rejected. Прямой pending → paid запрещён.
--
-- Идемпотентно: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / REVOKE / GRANT /
-- COMMENT / DROP POLICY IF EXISTS повторяемы.
-- Apply на живую БД: psql / Supabase SQL-editor (см. worklog, Task pay3-payout-audit).

-- === 1. orders.payout_reserved_at ===
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payout_reserved_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.payout_reserved_at IS
  'Момент резервирования заказа под payout-заявку (/api/payouts/request). NULL = заказ доступен для включения в заявку. При reject резерва — снова NULL. Финальная выплата — payout_transferred_at (admin PATCH action=complete); НЕ путать семантику: reserved = «входит в открытую заявку», transferred = «фактически выплачено».';

CREATE INDEX IF NOT EXISTS idx_orders_payout_reserved
  ON public.orders (confectioner_id)
  WHERE payout_reserved_at IS NOT NULL AND payout_transferred_at IS NULL;

-- === 2. add_confectioner_balance — атомарный инкремент (компенсация/возврат резерва) ===
CREATE OR REPLACE FUNCTION public.add_confectioner_balance(p_confectioner_id TEXT, p_amount INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN v_new_balance;
END;
$$;

-- === 3. Гранты: money/bonus RPC — только service_role ===
-- Сигнатурно-независимо (по proname) — переживает изменение аргументов.
DO $$
DECLARE
  fn record;
  fname TEXT;
BEGIN
  FOREACH fname IN ARRAY ARRAY[
    'add_confectioner_balance',
    'deduct_confectioner_balance',
    'add_bonus_balance',
    'deduct_bonus_balance'
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
END $$;

-- === 4. RLS payout_requests: UPDATE без INSPECTOR (разделение полномочий) ===
DROP POLICY IF EXISTS payouts_update_admin ON public.payout_requests;
CREATE POLICY payouts_update_admin ON public.payout_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
  );

-- === 5. Стейт-машина payout_requests (PAY-3) ===
COMMENT ON COLUMN public.payout_requests.status IS
  'Стейт-машина PAY-3: pending (средства зарезервированы RPC deduct_confectioner_balance; состав — metadata.orders, заказы с payout_reserved_at) → approved (админ согласовал; деньги ещё не двигали) → paid (admin complete: ФАКТИЧЕСКАЯ выплата подтверждена, orders.payout_transferred_at проставлен) | rejected (админ отклонил: резерв возвращён RPC add_confectioner_balance, payout_reserved_at снят). pending → paid напрямую запрещён; approve/reject/complete — CAS по исходному статусу.';

COMMENT ON COLUMN public.payout_requests.method IS
  'Способ выплаты: card | sbp | bank_account (комментарий 0009 «card|sbp|invoice» устарел; PAY-2 унифицирует enum в коде и БД).';
