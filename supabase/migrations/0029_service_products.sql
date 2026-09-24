-- ============================================================================
-- 0029_service_products.sql
--
-- Таблица объявлений услуг (витрина «Услуги и площадки» → /services-shop).
-- Провайдеры: ANIMATOR_AGENCY, RECREATION_CENTER, KIDS_CLUB, VENUE_OWNER,
--             EVENT_ORGANIZER, FOOD_SERVICE, ADMIN (управление).
--
-- Отвечает на требование ролевого аудита: у каждой «исполнительской» роли
-- должен быть бэкенд-объявлений с полным CRUD (создание / редактирование /
-- добавление ещё одного / удаление / вкл-выкл публикации).
--
-- Стиль согласован с venues (миграция 0019): snake_case, price в копейках,
-- RLS public-read на активные + owner-write, гранты anon/authenticated.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_role   TEXT NOT NULL DEFAULT 'ANIMATOR_AGENCY',   -- роль владельца объявления
  title           TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL,                              -- slug из SERVICE_CATEGORIES (animator_clown, fireworks, balloons, photo_video, quest, masterclass, ...)
  price_type      TEXT NOT NULL DEFAULT 'fixed',              -- fixed | per_hour | per_event | per_guest
  price           INTEGER NOT NULL DEFAULT 0,                 -- копейки
  old_price       INTEGER,                                    -- копейки (зачёркнутая)
  duration_minutes INTEGER,                                   -- длительность услуги
  age_min         INTEGER,                                    -- минимальный возраст (аниматоры, детские программы)
  age_max         INTEGER,
  city            TEXT,                                       -- город оказания услуги
  region          TEXT,
  service_format  TEXT NOT NULL DEFAULT 'travel',             -- venue (у себя) | travel (выезд) | both
  images          TEXT[] DEFAULT '{}',
  tags            TEXT[] DEFAULT '{}',
  includes        TEXT[] DEFAULT '{}',                        -- что входит в стоимость
  safety_note     TEXT,                                       -- предупреждение по безопасности (пиротехника)
  customizable    BOOLEAN DEFAULT FALSE,                      -- персонализация программы
  suitable_for    TEXT[] DEFAULT '{}',                        -- birthday, corporate, kids_party, ...
  contacts        JSONB DEFAULT '{}'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,              -- soft-delete / пауза публикации
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  rating          DECIMAL(2, 1) DEFAULT 0,
  reviews_count   INTEGER DEFAULT 0,
  bookings_count  INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_products_provider   ON public.service_products(provider_id);
CREATE INDEX IF NOT EXISTS idx_service_products_role       ON public.service_products(provider_role);
CREATE INDEX IF NOT EXISTS idx_service_products_category   ON public.service_products(category);
CREATE INDEX IF NOT EXISTS idx_service_products_city       ON public.service_products(city);
CREATE INDEX IF NOT EXISTS idx_service_products_is_active  ON public.service_products(is_active);
CREATE INDEX IF NOT EXISTS idx_service_products_created_at ON public.service_products(created_at DESC);

COMMENT ON TABLE public.service_products IS 'Объявления услуг для праздника (аниматоры, шоу, квесты, мастер-классы, фото)';
COMMENT ON COLUMN public.service_products.price IS 'Цена в КОПЕЙКАХ (fixed) или за единицу price_type';
COMMENT ON COLUMN public.service_products.category IS 'slug из src/lib/mock-data-services.ts SERVICE_CATEGORIES';

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.service_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_products_select_active" ON public.service_products;
CREATE POLICY "service_products_select_active" ON public.service_products
  FOR SELECT USING (
    is_active = TRUE
    OR provider_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
        AND ur.is_active = true
    )
  );

DROP POLICY IF EXISTS "service_products_insert_owner" ON public.service_products;
CREATE POLICY "service_products_insert_owner" ON public.service_products
  FOR INSERT WITH CHECK (
    provider_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

DROP POLICY IF EXISTS "service_products_update_owner_or_admin" ON public.service_products;
CREATE POLICY "service_products_update_owner_or_admin" ON public.service_products
  FOR UPDATE USING (
    provider_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
        AND ur.is_active = true
    )
  );

DROP POLICY IF EXISTS "service_products_delete_owner_or_admin" ON public.service_products;
CREATE POLICY "service_products_delete_owner_or_admin" ON public.service_products
  FOR DELETE USING (
    provider_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- Гранты (как у venues)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_products TO anon, authenticated;

-- ============================================================================
-- Обновляемая витрина площадок: public-read уже настроен в 0019.
-- Дополнительно разрешаем MODERATOR'у деактивировать площадки.
-- ============================================================================
DROP POLICY IF EXISTS "venues_delete_owner_or_admin" ON public.venues;
CREATE POLICY "venues_delete_owner_or_admin" ON public.venues
  FOR DELETE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );
