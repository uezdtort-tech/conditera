-- 0035_payment_integrity.sql — PAY-1 (аудит платёжного контура @ 688afc9)
--
-- 1) RPC reserve_refund: атомарное резервирование остатка возврата.
--    Один UPDATE с условием — конкурентные вызовы сериализуются блокировкой
--    строки; совместные возвраты физически не могут превысить сумму платежа.
--    Возвращает НОВОЕ значение refund_amount (рубли); RAISE REFUND_LIMIT при
--    нехватке остатка / платеже не в статусе succeeded.
-- 2) Гранты: только service_role (роуты идут под admin-клиентом).
-- 3) Комментарий единиц refunds.amount (0009 «в копейках» устарел — pay0
--    унифицировал рубли по всему money-path).
--
-- Идемпотентно: CREATE OR REPLACE / REVOKE / GRANT / COMMENT повторяемы.

-- === 1. reserve_refund ===
CREATE OR REPLACE FUNCTION public.reserve_refund(p_payment_id UUID, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new NUMERIC;
BEGIN
  UPDATE public.payments
     SET refund_amount = COALESCE(refund_amount, 0) + p_amount,
         updated_at = NOW()
   WHERE id = p_payment_id
     AND status = 'succeeded'
     AND COALESCE(refund_amount, 0) + p_amount <= amount
  RETURNING refund_amount INTO v_new;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_LIMIT: платёж % отсутствует, не succeeded или остаток < %', p_payment_id, p_amount;
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_refund(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_refund(UUID, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_refund(UUID, NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_refund(UUID, NUMERIC) TO service_role;

COMMENT ON FUNCTION public.reserve_refund(UUID, NUMERIC) IS
'PAY-1: атомарное резервирование остатка возврата. Возвращает новый refund_amount (рубли); RAISE REFUND_LIMIT при нехватке/неверном статусе. Вызов: только service_role.';

-- === 2. Единицы refunds.amount ===
COMMENT ON COLUMN public.refunds.amount IS
'Сумма возврата в РУБЛЯХ (комментарий 0009 «в копейках» устарел — pay0 унифицировал рубли).';
