-- ============================================================================
-- 0032_db_fixes_and_optimization.sql
--
-- 1) UUID-ключи без default: 0017_sync_missing_tables создала ряд таблиц
--    с id UUID PRIMARY KEY БЕЗ gen_random_uuid() — любые INSERT без id падали
--    ("null value in column id violates not-null constraint", например
--    maintenance_logs из cron/cleanup и cron/backup). Добавляем default всем
--    public-таблицам с uuid-id без default (идемпотентно).
--
-- 2) Оптимизация горячих путей: индексы для частых запросов витрин и API
--    (см. pg_stat-less аудит: фильтры /api/services, /api/venues, /api/products,
--    notifications по user, orders по customer, profiles по is_blocked).
--
-- После DDL run-sql.js сам шлёт NOTIFY pgrst 'reload schema'.
-- ============================================================================

-- ---- 1. Defaults для uuid-PK без default -----------------------------------
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_name = c.table_name AND tb.table_schema = 'public'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'id'
      AND c.data_type = 'uuid'
      AND c.column_default IS NULL
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid();', t.table_name);
    RAISE NOTICE 'default added: %.id', t.table_name;
  END LOOP;
END $$;

-- ---- 1b. TEXT-ключи без default (0017 создавал TEXT-id без генерации) -------
-- maintenance_logs.id — TEXT без default: INSERT из cron/cleanup и cron/backup
-- падал с "null value in column id violates not-null constraint".
ALTER TABLE public.maintenance_logs
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- ---- 2. Индексы горячих путей ----------------------------------------------
-- service_products: сортировка витрины «популярное»
CREATE INDEX IF NOT EXISTS idx_service_products_popular
  ON public.service_products(bookings_count DESC, created_at DESC)
  WHERE is_active = TRUE;
-- service_products: роль провайдера + активность (mine=1)
CREATE INDEX IF NOT EXISTS idx_service_products_provider_active
  ON public.service_products(provider_id, is_active);

-- venues: публичная витрина (город + активные)
CREATE INDEX IF NOT EXISTS idx_venues_city_active
  ON public.venues(city, is_active);

-- products: витрина каталога
CREATE INDEX IF NOT EXISTS idx_products_status_created
  ON public.products(status, created_at DESC);

-- notifications: колокол пользователя (свежие непрочитанные)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

-- orders: заказы пользователя и cron-выборки по дате
CREATE INDEX IF NOT EXISTS idx_orders_customer_created
  ON public.orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON public.orders(created_at DESC);

-- user_roles: requireAnyRole (user_id + is_active)
CREATE INDEX IF NOT EXISTS idx_user_roles_user_active
  ON public.user_roles(user_id, is_active);

-- organization_verifications: findOrganizationsNeedingRecheck
CREATE INDEX IF NOT EXISTS idx_org_verif_conf_created
  ON public.organization_verifications(confectioner_id, created_at DESC);

-- ---- 3. Статистика планировщика ---------------------------------------------
ANALYZE public.service_products;
ANALYZE public.venues;
ANALYZE public.products;
ANALYZE public.notifications;
ANALYZE public.orders;
ANALYZE public.profiles;
ANALYZE public.user_roles;
ANALYZE public.organization_verifications;
