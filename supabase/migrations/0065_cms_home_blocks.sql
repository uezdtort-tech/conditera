-- 0065: Persistent editable homepage CMS blocks.
CREATE TABLE IF NOT EXISTS public.cms_home_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL CHECK (section IN ('hero','stats','cta_confectioner','advantages','steps','testimonials')),
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  link_url TEXT,
  link_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cms_home_blocks_section_order
  ON public.cms_home_blocks(section, sort_order, created_at);
ALTER TABLE public.cms_home_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cms_home_blocks_public_read ON public.cms_home_blocks;
CREATE POLICY cms_home_blocks_public_read ON public.cms_home_blocks
  FOR SELECT USING (is_active = TRUE);
DROP POLICY IF EXISTS cms_home_blocks_admin_manage ON public.cms_home_blocks;
CREATE POLICY cms_home_blocks_admin_manage ON public.cms_home_blocks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN','SUPER_ADMIN','COPYWRITER')
        AND ur.is_active = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN','SUPER_ADMIN','COPYWRITER')
        AND ur.is_active = TRUE
    )
  );
GRANT SELECT ON public.cms_home_blocks TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.cms_home_blocks TO authenticated;
