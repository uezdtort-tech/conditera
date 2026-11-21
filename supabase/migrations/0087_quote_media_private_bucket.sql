-- 0087_quote_media_private_bucket.sql
-- Provision the private bucket in the same migration path as other production
-- buckets. The local Storage shim intentionally implements object operations,
-- not the Supabase bucket-administration API.
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, created_at, updated_at)
VALUES (
  'quote_media',
  'quote_media',
  FALSE,
  ARRAY['image/jpeg', 'image/png', 'image/webp'],
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      updated_at = now();

COMMENT ON TABLE public.quote_request_media IS
  'Private customer reference and cake-builder preview images attached to custom quote requests; access is mediated by authenticated quote/order API routes.';
