-- 0096_quote_project_media.sql
-- Visual project snapshot and private customer reference media for custom RFQs.
BEGIN;

ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS project_spec JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.quote_requests.project_spec IS
  'Immutable customer cake-builder snapshot: dimensions, base, filling, coating, up to five decor elements, dietary constraints and visualisation metadata.';

-- Private Storage bucket is provisioned lazily by the server-side quote-media
-- service. This migration intentionally depends only on PostgreSQL objects.
CREATE TABLE IF NOT EXISTS public.quote_request_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id UUID NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('customer_reference', 'builder_preview')),
  storage_path TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  width INTEGER,
  height INTEGER,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'deleted')),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_request_media_request
  ON public.quote_request_media(quote_request_id, uploaded_at);

ALTER TABLE public.quote_request_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_request_media FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_request_media TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_quote_request_media_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.status = 'approved' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.quote_request_id::text, 1));
    SELECT count(*)::integer INTO v_count
      FROM public.quote_request_media
     WHERE quote_request_id = NEW.quote_request_id
       AND status = 'approved'
       AND id IS DISTINCT FROM NEW.id;
    IF v_count >= 10 THEN
      RAISE EXCEPTION 'QUOTE_MEDIA_LIMIT'
        USING ERRCODE = '23514',
              DETAIL = 'A quote request may have at most ten reference images';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_request_media_limit ON public.quote_request_media;
CREATE TRIGGER trg_quote_request_media_limit
  BEFORE INSERT OR UPDATE OF quote_request_id, status
  ON public.quote_request_media
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quote_request_media_limit();

REVOKE ALL ON FUNCTION public.enforce_quote_request_media_limit() FROM PUBLIC, anon, authenticated;

COMMIT;
