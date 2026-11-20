-- 0068_cms_design_warm_defaults.sql
-- Keep the CMS design defaults aligned with the Conditera warm cream/graphite/berry identity.
-- Only untouched default rows are migrated; administrator-customized colors are preserved.

BEGIN;

ALTER TABLE public.design_settings
  ALTER COLUMN background_color SET DEFAULT '#F7F2E8';

UPDATE public.design_settings
SET background_color = '#F7F2E8',
    updated_at = NOW()
WHERE lower(background_color) = '#ffffff'
  AND updated_by IS NULL;

COMMIT;
