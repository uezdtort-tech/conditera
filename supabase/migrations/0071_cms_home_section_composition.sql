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
  ('stats', 'О платформе', 20, TRUE),
  ('cta_confectioner', 'Для кондитеров', 30, TRUE),
  ('advantages', 'Наши преимущества', 40, TRUE),
  ('steps', 'Как это работает', 50, TRUE),
  ('testimonials', 'Истории клиентов', 60, TRUE)
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
