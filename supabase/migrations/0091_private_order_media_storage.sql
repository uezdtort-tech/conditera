-- 0077_private_order_media_storage.sql
-- Production/QC photos are private order evidence, not public product media.
-- Service-role API uploads/downloads only after checking order participants.
-- No anon/authenticated object policies are created intentionally.

INSERT INTO storage.buckets (id, name, public, allowed_mime_types, created_at, updated_at)
VALUES (
  'order_media',
  'order_media',
  false,
  ARRAY['image/jpeg', 'image/png', 'image/webp'],
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      updated_at = now();

COMMENT ON TABLE public.order_media IS
  'Private Supabase Storage object metadata for order production/QC/handoff evidence. Access is mediated by authenticated order API routes.';
