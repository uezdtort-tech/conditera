-- 0023_pricing_components.sql
-- ============================================================================
-- Компоненты ценообразования кондитера — расширенная модель цены.
--
-- Каждый кондитер может настроить индивидуальные цены на:
--   • Упаковку (базовая, премиум, подарочная, индивидуальная)
--   • Пищевую печать (на вафельной бумаге, на шоколаде, на топпере)
--   • Хранение (если нужен срок хранения дольше стандартного)
--   • Декорирование (сахарные цветы, аэрограф, ручная роспись, 3D-фигуры)
--   • Доставку (по городу, межгород, экспресс, ночь)
--   • Дополнительные услуги (установка, дегустация, срочность)
--
-- Все цены — в копейках (INTEGER) для точности.
-- Все цены привязаны к локации (city) кондитера.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.confectioner_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confectioner_id TEXT NOT NULL REFERENCES public.confectioners(id) ON DELETE CASCADE,

  -- Локация (город) для которой действуют цены
  -- Один кондитер может работать в нескольких городах с разными ценами
  city TEXT NOT NULL,

  -- ===== Базовая цена за изделие =====
  base_price_per_portion INTEGER NOT NULL DEFAULT 180,  -- ₽ за порцию (копейки)
  base_price_per_kg INTEGER NOT NULL DEFAULT 1200,       -- ₽ за 1 кг (копейки)
  min_order_price INTEGER NOT NULL DEFAULT 0,            -- мин. сумма заказа

  -- ===== Упаковка =====
  packaging_basic_price INTEGER NOT NULL DEFAULT 0,      -- базовая упаковка (бесплатно)
  packaging_premium_price INTEGER NOT NULL DEFAULT 30000, -- премиум-упаковка (300₽)
  packaging_gift_price INTEGER NOT NULL DEFAULT 50000,    -- подарочная упаковка (500₽)
  packaging_custom_price INTEGER NOT NULL DEFAULT 100000, -- индивидуальный дизайн (1000₽)

  -- ===== Пищевая печать =====
  print_wafer_price INTEGER NOT NULL DEFAULT 20000,      -- печать на вафельной бумаге (200₽)
  print_chocolate_price INTEGER NOT NULL DEFAULT 35000,  -- печать на шоколаде (350₽)
  print_topper_price INTEGER NOT NULL DEFAULT 15000,    -- печать на топпере (150₽)
  print_photo_price INTEGER NOT NULL DEFAULT 25000,      -- фото-печать на торте (250₽)

  -- ===== Декорирование (доп. к базовому декору) =====
  decor_sugar_flowers_price INTEGER NOT NULL DEFAULT 0,     -- сахарные цветы (за шт)
  decor_airbrush_price INTEGER NOT NULL DEFAULT 50000,     -- аэрограф (500₽)
  decor_hand_painting_price INTEGER NOT NULL DEFAULT 80000, -- ручная роспись (800₽)
  decor_3d_figures_price INTEGER NOT NULL DEFAULT 150000,   -- 3D-фигуры (1500₽ за шт)
  decor_isomalt_price INTEGER NOT NULL DEFAULT 40000,       -- изомальт (400₽)
  decor_wafer_paper_price INTEGER NOT NULL DEFAULT 30000,    -- вафельная бумага (300₽)

  -- ===== Хранение =====
  storage_standard_hours INTEGER NOT NULL DEFAULT 48,       -- стандартное хранение (часов)
  storage_extended_price INTEGER NOT NULL DEFAULT 5000,     -- доплата за доп. сутки (50₽)
  storage_refrigerated_price INTEGER NOT NULL DEFAULT 10000, -- холодильное хранение (100₽/сутки)

  -- ===== Доставка =====
  delivery_in_city_price INTEGER NOT NULL DEFAULT 30000,    -- по городу (300₽)
  delivery_in_city_free_from INTEGER NOT NULL DEFAULT 300000, -- бесплатно от 3000₽
  delivery_suburb_price INTEGER NOT NULL DEFAULT 50000,    -- пригород (500₽)
  delivery_intercity_price INTEGER NOT NULL DEFAULT 0,      -- межгород (рассчитывается)
  delivery_express_price INTEGER NOT NULL DEFAULT 70000,   -- экспресс (700₽, 3 часа)
  delivery_night_price INTEGER NOT NULL DEFAULT 100000,    -- ночная доставка (1000₽)
  delivery_self_pickup_discount INTEGER NOT NULL DEFAULT 0,  -- скидка при самовывозе (копейки)

  -- ===== Дополнительные услуги =====
  service_installation_price INTEGER NOT NULL DEFAULT 0,   -- установка на мероприятии
  service_tasting_price INTEGER NOT NULL DEFAULT 20000,    -- дегустация (200₽/набор)
  service_urgency_surcharge INTEGER NOT NULL DEFAULT 30,    -- наценка за срочность (%)
  service_urgency_min_days INTEGER NOT NULL DEFAULT 2,      -- мин. дней для срочности
  service_inscription_price INTEGER NOT NULL DEFAULT 0,     -- надпись (бесплатно)
  service_custom_design_price INTEGER NOT NULL DEFAULT 50000, -- индивидуальный дизайн (500₽)

  -- ===== Скидки и переговоры =====
  -- Кондитер готов обсуждать скидку с покупателем
  accepts_discount_requests BOOLEAN NOT NULL DEFAULT TRUE,
  -- Максимальная скидка, которую кондитер может дать (%)
  max_discount_percent INTEGER NOT NULL DEFAULT 10 CHECK (max_discount_percent BETWEEN 0 AND 50),
  -- Минимальная сумма заказа для обсуждения скидки
  discount_min_order INTEGER NOT NULL DEFAULT 500000,  -- от 5000₽

  -- ===== Метаданные =====
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Один кондитер = одна запись на город
  UNIQUE(confectioner_id, city)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_pricing_confectioner ON public.confectioner_pricing(confectioner_id);
CREATE INDEX IF NOT EXISTS idx_pricing_city ON public.confectioner_pricing(city);
CREATE INDEX IF NOT EXISTS idx_pricing_active ON public.confectioner_pricing(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pricing_confectioner_city ON public.confectioner_pricing(confectioner_id, city);

COMMENT ON TABLE public.confectioner_pricing IS 'Компоненты ценообразования кондитера — упаковка, печать, декор, хранение, доставка, скидки';
COMMENT ON COLUMN public.confectioner_pricing.base_price_per_portion IS 'Базовая цена за порцию в копейках';
COMMENT ON COLUMN public.confectioner_pricing.packaging_basic_price IS 'Базовая упаковка (обычно 0 = бесплатно)';
COMMENT ON COLUMN public.confectioner_pricing.accepts_discount_requests IS 'Конфитер готов обсуждать скидку';
COMMENT ON COLUMN public.confectioner_pricing.max_discount_percent IS 'Максимальная скидка (0-50%)';
COMMENT ON COLUMN public.confectioner_pricing.discount_min_order IS 'Мин. сумма для обсуждения скидки (копейки)';

-- RLS: публичное чтение (для расчёта цен покупателями), запись — владелец или админ
ALTER TABLE public.confectioner_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pricing_select_public" ON public.confectioner_pricing;
CREATE POLICY "pricing_select_public" ON public.confectioner_pricing
  FOR SELECT USING (is_active = TRUE);

DROP POLICY IF EXISTS "pricing_insert_own" ON public.confectioner_pricing;
CREATE POLICY "pricing_insert_own" ON public.confectioner_pricing
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.confectioners c
      WHERE c.id = confectioner_id
        AND c."userId" = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

DROP POLICY IF EXISTS "pricing_update_own" ON public.confectioner_pricing;
CREATE POLICY "pricing_update_own" ON public.confectioner_pricing
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.confectioners c
      WHERE c.id = confectioner_id
        AND c."userId" = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- Таблица quote_requests — запросы цен от покупателей к кондитерам
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_avatar TEXT,

  -- Параметры заказа из конструктора
  product_type TEXT,
  product_type_label TEXT,
  event_type TEXT,
  base TEXT,
  filling TEXT,
  filling_id TEXT,  -- UUID из public.fillings
  coating TEXT,
  decorations TEXT[] DEFAULT '{}',
  dietary TEXT[] DEFAULT '{}',
  servings INTEGER,
  quantity INTEGER,
  tiers INTEGER DEFAULT 1,
  shape TEXT,
  inscription TEXT,
  comment TEXT,

  -- Локация
  city TEXT NOT NULL,
  delivery_date TEXT,
  delivery_type TEXT DEFAULT 'delivery',
  address TEXT,

  -- Запрос скидки
  discount_requested BOOLEAN DEFAULT FALSE,
  discount_percent INTEGER DEFAULT 0,
  discount_comment TEXT,

  -- Оценочная стоимость (из конструктора)
  estimated_price INTEGER NOT NULL DEFAULT 0,  -- копейки
  estimated_delivery_cost INTEGER NOT NULL DEFAULT 0,

  -- Выбранные кондитеры (до 5)
  confectioner_ids TEXT[] NOT NULL DEFAULT '{}',

  -- Статус
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'quoted', 'approved', 'rejected', 'expired', 'cancelled')),

  -- Срок действия запроса
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_customer ON public.quote_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_quote_confectioners ON public.quote_requests USING GIN (confectioner_ids);
CREATE INDEX IF NOT EXISTS idx_quote_status ON public.quote_requests(status);
CREATE INDEX IF NOT EXISTS idx_quote_city ON public.quote_requests(city);
CREATE INDEX IF NOT EXISTS idx_quote_created ON public.quote_requests(created_at DESC);

COMMENT ON TABLE public.quote_requests IS 'Запросы цен от покупателей к кондитерам (до 5 кондитеров на запрос)';

ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quote_select_own_or_confectioner" ON public.quote_requests;
CREATE POLICY "quote_select_own_or_confectioner" ON public.quote_requests
  FOR SELECT USING (
    customer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.confectioners c
      WHERE c.id = ANY(confectioner_ids)
        AND c."userId" = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

DROP POLICY IF EXISTS "quote_insert_auth" ON public.quote_requests;
CREATE POLICY "quote_insert_auth" ON public.quote_requests
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "quote_update_own_or_confectioner" ON public.quote_requests;
CREATE POLICY "quote_update_own_or_confectioner" ON public.quote_requests
  FOR UPDATE USING (
    customer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.confectioners c
      WHERE c.id = ANY(confectioner_ids)
        AND c."userId" = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

-- ============================================================================
-- Таблица confectioner_quotes — ценовые предложения от кондитеров
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.confectioner_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id UUID NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  confectioner_id TEXT NOT NULL REFERENCES public.confectioners(id) ON DELETE CASCADE,

  -- Детальная разбивка цены (все компоненты)
  base_cost INTEGER NOT NULL DEFAULT 0,          -- базовая стоимость изделия
  filling_cost INTEGER NOT NULL DEFAULT 0,        -- стоимость начинки
  coating_cost INTEGER NOT NULL DEFAULT 0,         -- стоимость покрытия
  decoration_cost INTEGER NOT NULL DEFAULT 0,      -- стоимость декора
  packaging_cost INTEGER NOT NULL DEFAULT 0,       -- упаковка
  printing_cost INTEGER NOT NULL DEFAULT 0,        -- пищевая печать
  storage_cost INTEGER NOT NULL DEFAULT 0,         -- хранение
  delivery_cost INTEGER NOT NULL DEFAULT 0,       -- доставка
  service_cost INTEGER NOT NULL DEFAULT 0,        -- доп. услуги (установка, срочность)
  custom_design_cost INTEGER NOT NULL DEFAULT 0,  -- индивидуальный дизайн

  -- Итого до скидки
  subtotal INTEGER NOT NULL DEFAULT 0,

  -- Скидка (если кондитер согласен)
  discount_percent INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,

  -- Итого к оплате
  total_price INTEGER NOT NULL DEFAULT 0,

  -- Сроки
  prep_days INTEGER NOT NULL DEFAULT 3,
  available_date TEXT,

  -- Комментарий кондитера
  comment TEXT,

  -- Предложенные доп. опции
  offered_packaging TEXT,  -- basic|premium|gift|custom
  offered_delivery TEXT,    -- in_city|suburb|express|night|self_pickup

  -- Статус
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(quote_request_id, confectioner_id)
);

CREATE INDEX IF NOT EXISTS idx_quotes_request ON public.confectioner_quotes(quote_request_id);
CREATE INDEX IF NOT EXISTS idx_quotes_confectioner ON public.confectioner_quotes(confectioner_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.confectioner_quotes(status);

COMMENT ON TABLE public.confectioner_quotes IS 'Ценовые предложения от кондитеров с детальной разбивкой';

ALTER TABLE public.confectioner_quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotes_select_related" ON public.confectioner_quotes;
CREATE POLICY "quotes_select_related" ON public.confectioner_quotes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.quote_requests qr
      WHERE qr.id = quote_request_id
        AND (qr.customer_id = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.confectioners c
               WHERE c.id = confectioner_id
                 AND c."userId" = auth.uid()::text
             ))
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

DROP POLICY IF EXISTS "quotes_insert_confectioner" ON public.confectioner_quotes;
CREATE POLICY "quotes_insert_confectioner" ON public.confectioner_quotes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.confectioners c
      WHERE c.id = confectioner_id
        AND c."userId" = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "quotes_update_confectioner" ON public.confectioner_quotes;
CREATE POLICY "quotes_update_confectioner" ON public.confectioner_quotes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.confectioners c
      WHERE c.id = confectioner_id
        AND c."userId" = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM public.quote_requests qr
      WHERE qr.id = quote_request_id
        AND qr.customer_id = auth.uid()
    )
  );
