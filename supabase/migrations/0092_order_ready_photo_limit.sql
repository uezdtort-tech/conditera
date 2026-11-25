-- Integrated migration 0092_order_ready_photo_limit.sql; source branch version 0078_order_ready_photo_limit.sql.
-- 0092_order_ready_photo_limit.sql
-- Enforce the five approved ready-photo limit inside PostgreSQL.
-- The API pre-check is UX only; this trigger serializes concurrent uploads.

CREATE OR REPLACE FUNCTION public.enforce_order_ready_photo_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.kind = 'ready_photo' AND NEW.status = 'approved' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.order_id::text, 0));

    SELECT count(*)::integer
      INTO v_count
      FROM public.order_media
     WHERE order_id = NEW.order_id
       AND kind = 'ready_photo'
       AND status = 'approved'
       AND id IS DISTINCT FROM NEW.id;

    IF v_count >= 5 THEN
      RAISE EXCEPTION 'ORDER_READY_PHOTO_LIMIT'
        USING ERRCODE = '23514',
              DETAIL = 'An order may have at most five approved ready photos';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_ready_photo_limit ON public.order_media;
CREATE TRIGGER trg_order_ready_photo_limit
  BEFORE INSERT OR UPDATE OF order_id, kind, status
  ON public.order_media
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_ready_photo_limit();

REVOKE ALL ON FUNCTION public.enforce_order_ready_photo_limit() FROM PUBLIC, anon, authenticated;
