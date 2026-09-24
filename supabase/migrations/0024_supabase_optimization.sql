-- 0024_supabase_optimization.sql
-- ============================================================================
-- Оптимизация производительности Supabase / PostgreSQL.
--
-- Добавляет:
--   1. Составные индексы для частых запросов (orders, products, fillings)
--   2. Partial indexes для активных записей
--   3. Materialized view для статистики дашборда (admin revenue)
--   4. Оптимизация RLS политик (использование index на user_id)
--   5. Vacuum и analyze настройки для автоподдержки
-- ============================================================================

-- ===== 1. Составные индексы для частых запросов =====

-- Orders: частый запрос — user_id + status + created_at
CREATE INDEX IF NOT EXISTS idx_orders_customer_status_date
  ON public.orders(user_id, status, created_at DESC)
  WHERE status NOT IN ('CANCELLED', 'REFUNDED');

-- Orders: confectioner_id + status (для дашборда кондитера)
CREATE INDEX IF NOT EXISTS idx_orders_confectioner_status_date
  ON public.orders(confectioner_id, status, created_at DESC)
  WHERE status NOT IN ('CANCELLED', 'REFUNDED');

-- Products: category + published (для каталога)
CREATE INDEX IF NOT EXISTS idx_products_category_active
  ON public.products(category_id, status)
  WHERE status = 'published';

-- Fillings: status + usage_count (для конструктора — популярные сначала)
CREATE INDEX IF NOT EXISTS idx_fillings_status_usage
  ON public.fillings(status, usage_count DESC)
  WHERE status = 'APPROVED' AND is_active = TRUE;

-- Confectioner capabilities: GIN indexes уже созданы, добавим B-tree
CREATE INDEX IF NOT EXISTS idx_cap_confectioner_active
  ON public.confectioner_capabilities(confectioner_id)
  WHERE is_active = TRUE;

-- Quote requests: status + created_at (для списка запросов)
CREATE INDEX IF NOT EXISTS idx_quote_status_created
  ON public.quote_requests(status, created_at DESC);

-- Confectioner quotes: confectioner_id + status
CREATE INDEX IF NOT EXISTS idx_quotes_confectioner_status
  ON public.confectioner_quotes(confectioner_id, status);

-- Notifications: user_id + status (для непрочитанных)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, status)
  WHERE status = 'queued';

-- ===== 2. VACUUM и ANALYZE настройки =====

-- Автовакуум для часто обновляемых таблиц
ALTER TABLE public.orders SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.products SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.fillings SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.confectioner_capabilities SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.quote_requests SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

-- ===== 3. Materialized View для статистики =====

-- Ежемесячная выручка по кондитерам (для дашборда)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_confectioner_monthly_revenue AS
SELECT
  confectioner_id,
  DATE_TRUNC('month', created_at) as month,
  COUNT(*) as orders_count,
  SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_count,
  SUM(CASE WHEN status = 'COMPLETED' THEN total ELSE 0 END) as revenue
FROM public.orders
WHERE status NOT IN ('CANCELLED', 'REFUNDED')
  AND created_at > NOW() - INTERVAL '12 months'
GROUP BY confectioner_id, DATE_TRUNC('month', created_at)
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_revenue_confectioner_month
  ON mv_confectioner_monthly_revenue(confectioner_id, month);

COMMENT ON MATERIALIZED VIEW mv_confectioner_monthly_revenue IS 'Ежемесячная выручка по кондитерам — обновляется через REFRESH MATERIALIZED VIEW';

-- ===== 4. Функция для обновления materialized view =====

CREATE OR REPLACE FUNCTION public.refresh_monthly_revenue()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_confectioner_monthly_revenue;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.refresh_monthly_revenue IS 'Обновление materialized view для статистики выручки';

-- ===== 5. RPC функция для поиска кондитеров по способностям =====

CREATE OR REPLACE FUNCTION public.find_confectioners_by_capabilities(
  p_product_type TEXT DEFAULT NULL,
  p_base TEXT DEFAULT NULL,
  p_filling_id TEXT DEFAULT NULL,
  p_coating TEXT DEFAULT NULL,
  p_shape TEXT DEFAULT NULL,
  p_max_tiers INTEGER DEFAULT NULL,
  p_dietary TEXT[] DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  confectioner_id TEXT,
  business_name TEXT,
  avatar TEXT,
  city TEXT,
  rating DOUBLE PRECISION,
  reviews_count INTEGER,
  verified BOOLEAN,
  trust_level TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id as confectioner_id,
    c."businessName" as business_name,
    c.avatar,
    c.city,
    c.rating,
    c."reviewsCount" as reviews_count,
    c.verified,
    c."trustLevel" as trust_level
  FROM public.confectioner_capabilities cap
  JOIN public.confectioners c ON c.id = cap.confectioner_id
  WHERE cap.is_active = TRUE
    AND c.verified = TRUE
    AND (p_product_type IS NULL OR p_product_type = ANY(cap.product_types))
    AND (p_base IS NULL OR p_base = ANY(cap.bases))
    AND (p_filling_id IS NULL OR p_filling_id = ANY(cap.filling_ids))
    AND (p_coating IS NULL OR p_coating = ANY(cap.coatings))
    AND (p_shape IS NULL OR p_shape = ANY(cap.shapes))
    AND (p_max_tiers IS NULL OR cap.max_tiers >= p_max_tiers)
    AND (p_dietary IS NULL OR p_dietary <@ cap.dietary)
    AND (p_city IS NULL OR c.city = p_city)
  ORDER BY c.rating DESC, c."reviewsCount" DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.find_confectioners_by_capabilities IS 'Поиск кондитеров по параметрам конструктора (тип, основа, начинка, покрытие, форма, ярусы, диета, город)';

-- ===== 6. RPC: популярные товары по городу =====
CREATE OR REPLACE FUNCTION public.get_popular_products(
  p_city TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  product_id UUID,
  title TEXT,
  price INTEGER,
  images TEXT[],
  category TEXT,
  confectioner_id TEXT,
  confectioner_name TEXT,
  confectioner_avatar TEXT,
  rating DOUBLE PRECISION,
  reviews_count INTEGER,
  city TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.price,
    p.images,
    p.category,
    p."confectionerId",
    p."confectionerName",
    p."confectionerAvatar",
    p.rating,
    p."reviewsCount",
    c.city
  FROM public.products p
  JOIN public.confectioners c ON c.id = p."confectionerId"
  WHERE p."isHidden" IS NOT TRUE
    AND (p_city IS NULL OR c.city = p_city)
    AND (p_category IS NULL OR p.category = p_category)
  ORDER BY
    CASE WHEN p."isHit" THEN 0 ELSE 1 END,
    CASE WHEN p."isPopular" THEN 0 ELSE 1 END,
    p.rating DESC,
    p."reviewsCount" DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.get_popular_products IS 'Популярные товары по городу и категории — для главной страницы и каталога';
