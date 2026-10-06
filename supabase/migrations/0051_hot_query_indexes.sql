-- 0051_hot_query_indexes.sql
--
-- Оптимизация Supabase/PostgreSQL: составные индексы под горячие сортировки
-- (по фактическим запросам из access-логов прод-трафика), удаление
-- дублирующегося индекса, ANALYZE.
--
-- 1) products(status, reviews_count DESC) WHERE status='published':
--    GET /api/products?sort=popular (главная) сортирует published-каталог
--    по reviews_count DESC. Была только пара (status, created_at DESC) —
--    планировщик сортировал строки после фильтра.
--
-- 2) product_reviews(helpful_count DESC, created_at DESC) WHERE status='approved':
--    GET /api/reviews (блок «полезные отзывы» на главной) — точное покрытие
--    ORDER BY + фильтра, сортировка уходит в индекс.
--
-- 3) video_feed_items(rating DESC, createdAt DESC) WHERE status='active':
--    GET /api/video-feed — composite вместо двух отдельных индексов
--    (rating и createdAt по отдельности не покрывают двухключевой ORDER BY).
--
-- 4) service_products(created_at DESC) WHERE is_active:
--    GET /api/services?sort=popular|new — фильтр is_active + сортировка.
--
-- 5) Дубликат: idx_orders_created_at полностью повторяет idx_orders_created
--    (created_at DESC) — лишняя запись на каждый INSERT/UPDATE orders.

CREATE INDEX IF NOT EXISTS idx_products_status_reviews
    ON products (status, reviews_count DESC)
    WHERE (status = 'published');

CREATE INDEX IF NOT EXISTS idx_reviews_approved_helpful
    ON product_reviews (helpful_count DESC, created_at DESC)
    WHERE (status = 'approved');

CREATE INDEX IF NOT EXISTS idx_video_feed_active_rating
    ON video_feed_items ("rating" DESC, "createdAt" DESC)
    WHERE (status = 'active');

CREATE INDEX IF NOT EXISTS idx_service_products_active_created
    ON service_products (created_at DESC)
    WHERE (is_active = true);

DROP INDEX IF EXISTS idx_orders_created_at;

ANALYZE products;
ANALYZE product_reviews;
ANALYZE video_feed_items;
ANALYZE service_products;
ANALYZE orders;
