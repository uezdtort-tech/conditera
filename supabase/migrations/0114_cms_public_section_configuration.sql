-- 0114: Public clients need the full non-sensitive section configuration
-- to distinguish intentionally disabled sections from missing configuration.
DROP POLICY IF EXISTS cms_home_sections_public_read ON public.cms_home_sections;
CREATE POLICY cms_home_sections_public_read ON public.cms_home_sections
  FOR SELECT TO anon, authenticated USING (TRUE);
GRANT SELECT ON public.cms_home_sections TO anon, authenticated;
