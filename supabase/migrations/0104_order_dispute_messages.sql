-- 0104_order_dispute_messages.sql
-- Customer replies to a support request are append-only and audited.

CREATE TABLE IF NOT EXISTS public.order_dispute_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispute_id UUID NOT NULL REFERENCES public.order_disputes(id) ON DELETE RESTRICT,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  message TEXT NOT NULL CHECK (length(btrim(message)) BETWEEN 10 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_dispute_messages_dispute_idx
  ON public.order_dispute_messages(dispute_id, created_at);

DROP TRIGGER IF EXISTS order_dispute_messages_no_update ON public.order_dispute_messages;
CREATE TRIGGER order_dispute_messages_no_update
  BEFORE UPDATE OR DELETE ON public.order_dispute_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_order_dispute_evidence_mutation();
DROP TRIGGER IF EXISTS order_dispute_messages_no_truncate ON public.order_dispute_messages;
CREATE TRIGGER order_dispute_messages_no_truncate
  BEFORE TRUNCATE ON public.order_dispute_messages
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_dispute_evidence_mutation();

ALTER TABLE public.order_dispute_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_dispute_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.order_dispute_messages TO service_role;

COMMENT ON TABLE public.order_dispute_messages IS
  'Append-only customer/support messages in the formal order dispute process.';

NOTIFY pgrst, 'reload schema';
