-- 0121_cms_home_management.sql
-- Production schema for the CMS homepage editor: blocks, design defaults,
-- serialized reordering, editable sections, public configuration and safe
-- default ordering. Consolidated in dependency order into one atomic migration.
BEGIN;

-- -----------------------------------------------------------------------------
-- CMS home blocks (ported from 0065_cms_home_blocks.sql)
-- -----------------------------------------------------------------------------
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_home_blocks TO service_role;


-- -----------------------------------------------------------------------------
-- CMS design defaults (ported from 0068_cms_design_warm_defaults.sql)
-- -----------------------------------------------------------------------------
-- 0068_cms_design_warm_defaults.sql
-- Keep the CMS design defaults aligned with the Conditera warm cream/graphite/berry identity.
-- Only untouched default rows are migrated; administrator-customized colors are preserved.

ALTER TABLE public.design_settings
  ALTER COLUMN background_color SET DEFAULT '#F7F2E8';

UPDATE public.design_settings
SET background_color = '#F7F2E8',
    updated_at = NOW()
WHERE lower(background_color) = '#ffffff'
  AND updated_by IS NULL;


-- -----------------------------------------------------------------------------
-- atomic home-block reorder RPC (ported from 0069_cms_atomic_home_reorder.sql)
-- -----------------------------------------------------------------------------
-- Atomic, validated reordering for homepage CMS blocks.
CREATE OR REPLACE FUNCTION public.cms_reorder_home_blocks(
  p_section TEXT,
  p_block_ids UUID[],
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
  v_total INTEGER;
  v_distinct INTEGER;
BEGIN
  IF p_section NOT IN ('hero','stats','cta_confectioner','advantages','steps','testimonials')
     OR p_block_ids IS NULL
     OR cardinality(p_block_ids) = 0
     OR cardinality(p_block_ids) > 200
     OR p_actor IS NULL THEN
    RAISE EXCEPTION 'invalid reorder request' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT id)::INTEGER
    INTO v_distinct
    FROM unnest(p_block_ids) AS ids(id);

  IF v_distinct <> cardinality(p_block_ids) THEN
    RAISE EXCEPTION 'duplicate block ids' USING ERRCODE = '22023';
  END IF;

  PERFORM id
    FROM public.cms_home_blocks
   WHERE section = p_section
   FOR UPDATE;

  SELECT count(*)::INTEGER
    INTO v_total
    FROM public.cms_home_blocks
   WHERE section = p_section;

  SELECT count(*)::INTEGER
    INTO v_count
    FROM public.cms_home_blocks
   WHERE section = p_section
     AND id = ANY(p_block_ids);

  IF v_count <> cardinality(p_block_ids) OR v_total <> cardinality(p_block_ids) THEN
    RAISE EXCEPTION 'block set changed; reload and retry' USING ERRCODE = '40001';
  END IF;

  UPDATE public.cms_home_blocks AS block
     SET sort_order = ordered.ordinality * 10,
         updated_by = p_actor,
         updated_at = now()
    FROM unnest(p_block_ids) WITH ORDINALITY AS ordered(id, ordinality)
   WHERE block.id = ordered.id
     AND block.section = p_section;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_reorder_home_blocks(TEXT, UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_reorder_home_blocks(TEXT, UUID[], UUID) TO service_role;


-- -----------------------------------------------------------------------------
-- serialized reorder RPC (ported from 0070_cms_reorder_write_serialization.sql)
-- -----------------------------------------------------------------------------
-- 0070: Serialize homepage block reorders with concurrent CMS writes.
-- Row locks alone do not prevent a concurrent INSERT (phantom row) from
-- changing the section membership after the count check. This table lock
-- conflicts with INSERT/UPDATE/DELETE table locks and is held to transaction end.
CREATE OR REPLACE FUNCTION public.cms_reorder_home_blocks(
  p_section TEXT,
  p_block_ids UUID[],
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
  v_total INTEGER;
  v_distinct INTEGER;
BEGIN
  IF p_section NOT IN ('hero','stats','cta_confectioner','advantages','steps','testimonials')
     OR p_block_ids IS NULL
     OR cardinality(p_block_ids) = 0
     OR cardinality(p_block_ids) > 200
     OR p_actor IS NULL THEN
    RAISE EXCEPTION 'invalid reorder request' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT id)::INTEGER
    INTO v_distinct
    FROM unnest(p_block_ids) AS ids(id);

  IF v_distinct <> cardinality(p_block_ids) THEN
    RAISE EXCEPTION 'duplicate block ids' USING ERRCODE = '22023';
  END IF;

  LOCK TABLE public.cms_home_blocks IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*)::INTEGER
    INTO v_total
    FROM public.cms_home_blocks
   WHERE section = p_section;

  SELECT count(*)::INTEGER
    INTO v_count
    FROM public.cms_home_blocks
   WHERE section = p_section
     AND id = ANY(p_block_ids);

  IF v_count <> cardinality(p_block_ids) OR v_total <> cardinality(p_block_ids) THEN
    RAISE EXCEPTION 'block set changed; reload and retry' USING ERRCODE = '40001';
  END IF;

  UPDATE public.cms_home_blocks AS block
     SET sort_order = ordered.ordinality * 10,
         updated_by = p_actor,
         updated_at = now()
    FROM unnest(p_block_ids) WITH ORDINALITY AS ordered(id, ordinality)
   WHERE block.id = ordered.id
     AND block.section = p_section;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_reorder_home_blocks(TEXT, UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_reorder_home_blocks(TEXT, UUID[], UUID) TO service_role;


-- -----------------------------------------------------------------------------
-- CMS home-section composition (ported from 0071_cms_home_section_composition.sql)
-- -----------------------------------------------------------------------------
-- 0071: Persistent homepage section composition (visibility and global order).
CREATE TABLE IF NOT EXISTS public.cms_home_sections (
  section TEXT PRIMARY KEY CHECK (section IN ('hero','stats','cta_confectioner','advantages','steps','testimonials')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 1000),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.cms_home_sections (section, title, sort_order, is_enabled)
VALUES
  ('hero', 'От редакции', 10, TRUE),
  ('advantages', 'Наши преимущества', 20, TRUE),
  ('steps', 'Как это работает', 30, TRUE),
  ('stats', 'О платформе', 40, TRUE),
  ('testimonials', 'Истории клиентов', 50, TRUE),
  ('cta_confectioner', 'Для кондитеров', 60, TRUE)
ON CONFLICT (section) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_cms_home_sections_order
  ON public.cms_home_sections(sort_order, section);

ALTER TABLE public.cms_home_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cms_home_sections_public_read ON public.cms_home_sections;
CREATE POLICY cms_home_sections_public_read ON public.cms_home_sections
  FOR SELECT USING (is_enabled = TRUE);

GRANT SELECT ON public.cms_home_sections TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_home_sections TO service_role;

CREATE OR REPLACE FUNCTION public.cms_update_home_sections(
  p_sections JSONB,
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total INTEGER;
  v_distinct INTEGER;
  v_valid INTEGER;
BEGIN
  IF p_sections IS NULL OR jsonb_typeof(p_sections) <> 'array'
     OR jsonb_array_length(p_sections) <> 6 OR p_actor IS NULL THEN
    RAISE EXCEPTION 'invalid homepage sections payload' USING ERRCODE = '22023';
  END IF;

  LOCK TABLE public.cms_home_sections IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(DISTINCT section)::INTEGER,
         count(*) FILTER (
           WHERE section IN ('hero','stats','cta_confectioner','advantages','steps','testimonials')
             AND title IS NOT NULL AND char_length(title) BETWEEN 1 AND 100
             AND sort_order BETWEEN 0 AND 1000
             AND is_enabled IS NOT NULL
         )::INTEGER
    INTO v_distinct, v_valid
    FROM jsonb_to_recordset(p_sections) AS x(
      section TEXT, title TEXT, sort_order INTEGER, is_enabled BOOLEAN
    );

  SELECT count(*)::INTEGER INTO v_total FROM public.cms_home_sections;

  IF v_distinct <> 6 OR v_valid <> 6 OR v_total <> 6 THEN
    RAISE EXCEPTION 'homepage sections must contain all six valid sections' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_sections) AS x(
        section TEXT, title TEXT, sort_order INTEGER, is_enabled BOOLEAN
      )
     GROUP BY sort_order
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate section order' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cms_home_sections AS target
     SET title = source.title,
         sort_order = source.sort_order,
         is_enabled = source.is_enabled,
         updated_by = p_actor,
         updated_at = now()
    FROM jsonb_to_recordset(p_sections) AS source(
      section TEXT, title TEXT, sort_order INTEGER, is_enabled BOOLEAN
    )
   WHERE target.section = source.section;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_update_home_sections(JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_update_home_sections(JSONB, UUID) TO service_role;


-- -----------------------------------------------------------------------------
-- public section configuration (ported from 0072_cms_public_section_configuration.sql)
-- -----------------------------------------------------------------------------
-- 0072: Public clients need the full non-sensitive section configuration
-- to distinguish intentionally disabled sections from missing configuration.
DROP POLICY IF EXISTS cms_home_sections_public_read ON public.cms_home_sections;
CREATE POLICY cms_home_sections_public_read ON public.cms_home_sections
  FOR SELECT TO anon, authenticated USING (TRUE);
GRANT SELECT ON public.cms_home_sections TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- safe default section ordering (ported from 0073_cms_home_section_default_order.sql)
-- -----------------------------------------------------------------------------
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

COMMIT;
