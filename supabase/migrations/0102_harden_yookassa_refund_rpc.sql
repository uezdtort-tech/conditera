-- 0102_harden_yookassa_refund_rpc.sql
-- Harden the webhook ledger RPC:
-- 1. A repeated provider refund ID is idempotent only for the same payment and amount.
-- 2. Different refund IDs cannot cumulatively refund more than the original payment.
-- 3. Lock the payment row before checking/inserting to serialize concurrent refunds.
-- Existing signature and return contract are preserved.

CREATE OR REPLACE FUNCTION public.apply_yookassa_refund(
  p_payment_id uuid,
  p_refund_id text,
  p_amount_kopecks integer
)
RETURNS TABLE (
  already_processed boolean,
  total_refunded_kopecks integer,
  fully_refunded boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_amount numeric;
  v_refund_amount numeric;
  v_existing_payment_id uuid;
  v_existing_amount integer;
  v_inserted boolean;
BEGIN
  IF p_payment_id IS NULL
     OR p_refund_id IS NULL
     OR length(btrim(p_refund_id)) = 0
     OR p_amount_kopecks IS NULL
     OR p_amount_kopecks <= 0 THEN
    RAISE EXCEPTION 'invalid refund arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT amount, COALESCE(refund_amount, 0)
    INTO v_payment_amount, v_refund_amount
    FROM public.payments
   WHERE id = p_payment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment % not found', p_payment_id
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.yookassa_refund_events (refund_id, payment_id, amount_kopecks)
  VALUES (p_refund_id, p_payment_id, p_amount_kopecks)
  ON CONFLICT (refund_id) DO NOTHING;

  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT payment_id, amount_kopecks
      INTO v_existing_payment_id, v_existing_amount
      FROM public.yookassa_refund_events
     WHERE refund_id = p_refund_id;

    IF NOT FOUND
       OR v_existing_payment_id IS DISTINCT FROM p_payment_id
       OR v_existing_amount IS DISTINCT FROM p_amount_kopecks THEN
      RAISE EXCEPTION 'refund id % was reused with different payment or amount', p_refund_id
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY
      SELECT true, ROUND(v_refund_amount * 100)::integer,
             v_refund_amount >= v_payment_amount;
    RETURN;
  END IF;

  IF (v_refund_amount * 100) + p_amount_kopecks > (v_payment_amount * 100) THEN
    RAISE EXCEPTION 'cumulative refund exceeds payment amount'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.payments
     SET refund_amount = v_refund_amount + (p_amount_kopecks::numeric / 100),
         status = CASE
           WHEN ((v_refund_amount * 100) + p_amount_kopecks) >= (v_payment_amount * 100)
             THEN 'refunded'
           ELSE status
         END,
         updated_at = now()
   WHERE id = p_payment_id
  RETURNING refund_amount INTO v_refund_amount;

  RETURN QUERY
    SELECT false, ROUND(v_refund_amount * 100)::integer,
           v_refund_amount >= v_payment_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_yookassa_refund(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_yookassa_refund(uuid, text, integer)
  TO service_role;
