-- 0087_quote_media_private_bucket.sql
-- Provision a private bucket where Supabase Storage is installed. The local
-- PG17 migration harness applies application migrations before Storage's
-- schema exists; its local object shim does not require bucket metadata.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
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
  END IF;
END;
$$;

COMMENT ON TABLE public.quote_request_media IS
  'Private customer reference and cake-builder preview images attached to custom quote requests; access is mediated by authenticated quote/order API routes.';
