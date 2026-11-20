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
