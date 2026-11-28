-- 0084_quote_customer_rejection.sql
-- Customer rejection is persisted and serialized against acceptance.
BEGIN;

ALTER TABLE public.confectioner_quotes
  ADD COLUMN IF NOT EXISTS customer_comment TEXT;

CREATE OR REPLACE FUNCTION public.reject_confectioner_quote(
  p_quote_id UUID,
  p_customer_id UUID,
  p_comment TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.confectioner_quotes%ROWTYPE;
  v_request public.quote_requests%ROWTYPE;
  v_pending_count INTEGER;
BEGIN
  SELECT * INTO v_quote
    FROM public.confectioner_quotes AS cq
   WHERE cq.id = p_quote_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;

  SELECT * INTO v_request
    FROM public.quote_requests AS qr
   WHERE qr.id = v_quote.quote_request_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_REQUEST_NOT_FOUND'; END IF;
  IF v_request.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'QUOTE_CUSTOMER_MISMATCH';
  END IF;
  IF v_quote.status <> 'pending' THEN
    RAISE EXCEPTION 'QUOTE_NOT_PENDING';
  END IF;

  UPDATE public.confectioner_quotes
     SET status = 'rejected',
         customer_comment = NULLIF(LEFT(COALESCE(p_comment, ''), 1000), ''),
         updated_at = now()
   WHERE id = p_quote_id;

  SELECT count(*)::integer INTO v_pending_count
    FROM public.confectioner_quotes
   WHERE quote_request_id = v_request.id
     AND status = 'pending';

  IF v_pending_count = 0 THEN
    UPDATE public.quote_requests
       SET status = 'rejected', updated_at = now()
     WHERE id = v_request.id
       AND status NOT IN ('approved', 'cancelled', 'expired');
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_confectioner_quote(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_confectioner_quote(UUID, UUID, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
