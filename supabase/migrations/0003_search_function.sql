-- ====================================================================
-- 0003_search_function.sql — Full Text Search через Postgres FTS
-- ====================================================================
-- Создаёт RPC функцию search_products(query, limit) → Product[]
-- Используется в useSearchProducts hook (через supabaseBrowser.rpc).
-- ====================================================================

CREATE OR REPLACE FUNCTION public.search_products(
  search_query TEXT,
  result_limit INTEGER DEFAULT 20
)
RETURNS SETOF public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.*
  FROM public.products p
  WHERE
    p.status = 'published'
    AND p.deleted_at IS NULL
    AND (
      -- Full Text Search по search_vector
      p.search_vector @@ to_tsquery('russian', search_query)
      OR
      -- Trigram поиск (для опечаток) — минимум 3 символа
      (LENGTH(search_query) >= 3 AND p.title % search_query)
    )
  ORDER BY
    -- Сначала точные совпадения по title (trigram)
    CASE WHEN p.title % search_query THEN 0 ELSE 1 END,
    -- Затем ранг FTS
    ts_rank(p.search_vector, to_tsquery('russian', search_query)) DESC
  LIMIT result_limit;
END;
$$;

COMMENT ON FUNCTION public.search_products IS 'RPC для поиска товаров через Postgres FTS + trigram';

-- Грант для anon + authenticated
GRANT EXECUTE ON FUNCTION public.search_products TO anon, authenticated;
