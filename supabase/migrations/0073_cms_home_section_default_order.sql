-- 0073: Upgrade untouched default homepage ordering after the hero was pinned.
-- Preserve every administrator-edited composition (updated_by is populated by the CMS RPC).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.cms_home_sections
     WHERE updated_by IS NOT NULL
  ) THEN
    UPDATE public.cms_home_sections
       SET sort_order = CASE section
         WHEN 'hero' THEN 10
         WHEN 'advantages' THEN 20
         WHEN 'steps' THEN 30
         WHEN 'stats' THEN 40
         WHEN 'testimonials' THEN 50
         WHEN 'cta_confectioner' THEN 60
       END
     WHERE section IN ('hero','advantages','steps','stats','testimonials','cta_confectioner');
  END IF;
END;
$$;
