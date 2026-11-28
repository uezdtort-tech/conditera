-- Integrated migration 0088_escrow_release_cancel_guard.sql; source branch version 0074_escrow_release_cancel_guard.sql.
-- 0088_escrow_release_cancel_guard.sql
-- P0: escrow release and order cancellation must be mutually exclusive.
-- Successful COMPLETED orders remain eligible for payout after the hold period.
-- CANCELLED and REFUNDED orders must never credit the confectioner.
--
-- Keep the existing RPC contract and grants; add cancellation/refund predicates
-- to the same atomic UPDATE that claims the escrow row.

CREATE OR REPLACE FUNCTION public.release_escrow_order(
  p_order_id UUID,
  p_conf_id TEXT,
  p_payout INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed INTEGER;
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
     AND status NOT IN ('CANCELLED', 'REFUNDED')
   RETURNING 1 INTO v_claimed;

  IF v_claimed IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.confectioners
     SET balance = COALESCE(balance, 0) + p_payout,
         "totalEarnings" = COALESCE("totalEarnings", 0) + p_payout
   WHERE id = p_conf_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'confectioner not found: %', p_conf_id;
  END IF;

  RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION public.release_escrow_order(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_escrow_order(UUID, TEXT, INTEGER)
  TO service_role;
