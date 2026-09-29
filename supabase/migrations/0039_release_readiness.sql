-- ============================================================================
-- 0039_release_readiness.sql — релизная готовность: безопасность и деньги
-- ============================================================================
-- Части:
--   1. RLS на confectioner_transactions (журнал финопераций кондитера).
--      До этой миграции: таблица создана в 0017:892 БЕЗ RLS, а 0011:314
--      выдал GRANT SELECT ... TO anon, authenticated на ВСЕ таблицы схемы —
--      балансы/суммы/заказы были читаемы любым anon через PostgREST.
--   2. RPC consume_tfa_backup_code_v2 — атомарное списание backup-кода
--      в ЖИВОЙ системе 2FA (колонки two_factor_*, которые пишет
--      /api/auth/2fa/setup+verify). 0037 покрывал только legacy-колонку
--      tfa_backup_codes. Семантика как в 0037: guard в WHERE → из двух
--      параллельных вызовов с одним кодом выигрывает ровно один.
--   3. Таблица yookassa_refund_events + RPC apply_yookassa_refund —
--      идемпотентная обработка refund.succeeded: дедуп по refund id,
--      атомарное суммирование refund_amount (прежде read-add-write —
--      повторная доставка вебхука задваивала сумму частичного возврата).
--
-- Идемпотентность: полная (IF NOT EXISTS / CREATE OR REPLACE / DO-гварды).
-- Обратная совместимость: additive, существующие сигнатуры не меняются.
-- ============================================================================

-- ===== 1. RLS confectioner_transactions =====

ALTER TABLE public.confectioner_transactions ENABLE ROW LEVEL SECURITY;

-- Убираем наследованный от 0011:314 широкий доступ
REVOKE ALL ON public.confectioner_transactions FROM anon, authenticated;

-- Владелец видит СВОИ транзакции (service_role обходит RLS — полный доступ)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'confectioner_transactions'
      AND policyname = 'confectioner_transactions_owner_select'
  ) THEN
    CREATE POLICY confectioner_transactions_owner_select
      ON public.confectioner_transactions
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

GRANT SELECT ON public.confectioner_transactions TO authenticated;

-- ===== 2. Атомарное списание backup-кода (live-система 2FA) =====

-- p_code_hash — ХЭШ кода (как хранится в two_factor_backup_codes).
-- Возвращает true, если именно этот вызов списал код; false — кода нет/уже списан.
CREATE OR REPLACE FUNCTION public.consume_tfa_backup_code_v2(
  p_user_id uuid,
  p_code_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining text[];
BEGIN
  UPDATE public.profiles
     SET two_factor_backup_codes = array_remove(two_factor_backup_codes, p_code_hash),
         updated_at = now()
   WHERE id = p_user_id
     AND two_factor_backup_codes @> ARRAY[p_code_hash]::text[]
  RETURNING two_factor_backup_codes INTO v_remaining;

  -- FOUND = строка обновлена (код был и списан этим вызовом)
  RETURN FOUND;
END;
$$;

-- Права: только service_role (вызывается серверными роутами)
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.consume_tfa_backup_code_v2(uuid, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.consume_tfa_backup_code_v2(uuid, text) TO service_role';
END $$;

-- ===== 3. Идемпотентная обработка возвратов YooKassa =====

CREATE TABLE IF NOT EXISTS public.yookassa_refund_events (
  refund_id      text PRIMARY KEY,
  payment_id     uuid NOT NULL,
  amount_kopecks integer NOT NULL CHECK (amount_kopecks > 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.yookassa_refund_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_yookassa_refund(
  p_payment_id    uuid,
  p_refund_id     text,
  p_amount_kopecks integer
)
RETURNS TABLE (already_processed boolean, total_refunded_kopecks integer, fully_refunded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund_amount numeric;
  v_amount        numeric;
BEGIN
  -- Дедуп по refund id: повторная доставка того же возврата не меняет суммы
  INSERT INTO public.yookassa_refund_events (refund_id, payment_id, amount_kopecks)
  VALUES (p_refund_id, p_payment_id, p_amount_kopecks)
  ON CONFLICT (refund_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT COALESCE(refund_amount, 0), amount
      INTO v_refund_amount, v_amount
      FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment % not found', p_payment_id;
    END IF;
    RETURN QUERY SELECT true, ROUND(v_refund_amount * 100)::integer, (v_refund_amount >= v_amount);
    RETURN;
  END IF;

  -- Атомарное суммирование + переход статуса в той же транзакции
  UPDATE public.payments
     SET refund_amount = COALESCE(payments.refund_amount, 0) + (p_amount_kopecks::numeric / 100),
         status = CASE
                    WHEN (COALESCE(payments.refund_amount, 0) * 100 + p_amount_kopecks) >= (payments.amount * 100)
                      THEN 'refunded'
                    ELSE payments.status
                  END,
         updated_at = now()
   WHERE id = p_payment_id
  RETURNING payments.refund_amount, payments.amount
    INTO v_refund_amount, v_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment % not found', p_payment_id;
  END IF;

  RETURN QUERY SELECT false, ROUND(v_refund_amount * 100)::integer, (v_refund_amount >= v_amount);
END;
$$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.apply_yookassa_refund(uuid, text, integer) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_yookassa_refund(uuid, text, integer) TO service_role';
END $$;

-- ===== Сводка =====
-- 1) журнал финопераций закрыт от anon; владелец — только свои записи;
-- 2) backup-коды live-2FA списываются атомарно (гонка закрыта, fail-closed в коде);
-- 3) refund-вебхук идемпотентен по refund id, сумма копится атомарно.
