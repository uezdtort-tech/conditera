-- 0104_order_disputes_and_immutable_evidence.sql
-- Formal order-defect disputes with immutable evidence and audit events.

ALTER TABLE public.order_media
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
ALTER TABLE public.order_media
  DROP CONSTRAINT IF EXISTS order_media_content_sha256_format;
ALTER TABLE public.order_media
  ADD CONSTRAINT order_media_content_sha256_format
  CHECK (
    content_sha256 IS NULL OR
    (length(content_sha256) = 64 AND content_sha256 !~ '[^0-9a-f]')
  );

CREATE TABLE IF NOT EXISTS public.order_disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  opened_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('quality', 'damage', 'wrong_item', 'missing_item', 'other')),
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 20 AND 5000),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'awaiting_customer', 'resolved', 'rejected')),
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS order_disputes_one_active_per_order
  ON public.order_disputes(order_id)
  WHERE status IN ('open', 'under_review', 'awaiting_customer');
CREATE INDEX IF NOT EXISTS order_disputes_status_created_idx
  ON public.order_disputes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS order_disputes_assignee_idx
  ON public.order_disputes(assigned_to, status) WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.order_dispute_evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispute_id UUID NOT NULL REFERENCES public.order_disputes(id) ON DELETE RESTRICT,
  order_media_id UUID NOT NULL REFERENCES public.order_media(id) ON DELETE RESTRICT,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  content_sha256 TEXT NOT NULL
    CHECK (length(content_sha256) = 64 AND content_sha256 !~ '[^0-9a-f]'),
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_media_id)
);
CREATE INDEX IF NOT EXISTS order_dispute_evidence_dispute_idx
  ON public.order_dispute_evidence(dispute_id, created_at);

CREATE OR REPLACE FUNCTION public.validate_order_dispute_evidence_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_dispute_order UUID;
  v_customer_id UUID;
  v_media_order UUID;
  v_media_uploader UUID;
  v_media_kind TEXT;
  v_media_hash TEXT;
BEGIN
  SELECT d.order_id, o.user_id, m.order_id, m.uploaded_by, m.kind, m.content_sha256
    INTO v_dispute_order, v_customer_id, v_media_order, v_media_uploader, v_media_kind, v_media_hash
  FROM public.order_disputes d
  JOIN public.orders o ON o.id = d.order_id
  JOIN public.order_media m ON m.id = NEW.order_media_id
  WHERE d.id = NEW.dispute_id;

  IF NOT FOUND
     OR v_dispute_order IS DISTINCT FROM v_media_order
     OR v_customer_id IS DISTINCT FROM NEW.uploaded_by
     OR v_media_uploader IS DISTINCT FROM NEW.uploaded_by
     OR v_media_kind IS DISTINCT FROM 'dispute_evidence'
     OR v_media_hash IS NULL
     OR v_media_hash IS DISTINCT FROM NEW.content_sha256 THEN
    RAISE EXCEPTION 'ORDER_DISPUTE_EVIDENCE_LINK_INVALID'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS order_dispute_evidence_validate_link ON public.order_dispute_evidence;
CREATE TRIGGER order_dispute_evidence_validate_link
  BEFORE INSERT ON public.order_dispute_evidence
  FOR EACH ROW EXECUTE FUNCTION public.validate_order_dispute_evidence_link();

CREATE TABLE IF NOT EXISTS public.order_dispute_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispute_id UUID NOT NULL REFERENCES public.order_disputes(id) ON DELETE RESTRICT,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_dispute_events_dispute_idx
  ON public.order_dispute_events(dispute_id, created_at);

CREATE OR REPLACE FUNCTION public.reject_order_dispute_evidence_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  RAISE EXCEPTION 'ORDER_DISPUTE_EVIDENCE_IMMUTABLE'
    USING ERRCODE = '55000';
END;
$fn$;

DROP TRIGGER IF EXISTS order_dispute_evidence_no_update ON public.order_dispute_evidence;
CREATE TRIGGER order_dispute_evidence_no_update
  BEFORE UPDATE OR DELETE ON public.order_dispute_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_order_dispute_evidence_mutation();

DROP TRIGGER IF EXISTS order_dispute_events_no_update ON public.order_dispute_events;
CREATE TRIGGER order_dispute_events_no_update
  BEFORE UPDATE OR DELETE ON public.order_dispute_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_order_dispute_evidence_mutation();

DROP TRIGGER IF EXISTS order_dispute_evidence_no_truncate ON public.order_dispute_evidence;
CREATE TRIGGER order_dispute_evidence_no_truncate
  BEFORE TRUNCATE ON public.order_dispute_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_dispute_evidence_mutation();
DROP TRIGGER IF EXISTS order_dispute_events_no_truncate ON public.order_dispute_events;
CREATE TRIGGER order_dispute_events_no_truncate
  BEFORE TRUNCATE ON public.order_dispute_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_dispute_evidence_mutation();

CREATE OR REPLACE FUNCTION public.protect_dispute_order_media()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.order_dispute_evidence
    WHERE order_media_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'ORDER_DISPUTE_EVIDENCE_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS order_media_dispute_evidence_immutable ON public.order_media;
CREATE TRIGGER order_media_dispute_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.order_media
  FOR EACH ROW EXECUTE FUNCTION public.protect_dispute_order_media();

CREATE OR REPLACE FUNCTION public.protect_dispute_order_media_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_dispute_evidence) THEN
    RAISE EXCEPTION 'ORDER_DISPUTE_EVIDENCE_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS order_media_dispute_evidence_no_truncate ON public.order_media;
CREATE TRIGGER order_media_dispute_evidence_no_truncate
  BEFORE TRUNCATE ON public.order_media
  FOR EACH STATEMENT EXECUTE FUNCTION public.protect_dispute_order_media_truncate();

ALTER TABLE public.order_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_dispute_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_dispute_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_disputes, public.order_dispute_evidence, public.order_dispute_events
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.order_disputes, public.order_dispute_evidence, public.order_dispute_events
  TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.order_dispute_events_id_seq TO service_role;

COMMENT ON TABLE public.order_disputes IS
  'Formal customer disputes for order defects, damage and missing/wrong items.';
COMMENT ON TABLE public.order_dispute_evidence IS
  'Immutable links to private order_media evidence and its SHA-256 content digest.';
COMMENT ON TABLE public.order_dispute_events IS
  'Append-only audit trail for dispute status changes and decisions.';

NOTIFY pgrst, 'reload schema';
