-- 0014_builder_config.sql
-- Конфигурация конструктора десертов, управляемая администратором.
-- Позволяет админу изменять типы изделий, начинки, покрытия, декор,
-- а также управлять предложениями кондитеров, коилен и ресторанов.

-- ===== 1. builder_config — настройки конструктора =====
CREATE TABLE IF NOT EXISTS public.builder_config (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL, -- 'product_types' | 'event_types' | 'bases' | 'fillings' | 'coatings' | 'decorations' | 'dietary' | 'shops'
  key TEXT NOT NULL, -- ID опции (например 'cake', 'birthday', 'sponge')
  label TEXT NOT NULL,
  description TEXT,
  icon TEXT, -- emoji или URL
  price_modifier INTEGER DEFAULT 0, -- наценка/базовая цена
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}', -- дополнительные данные (unit, minServings, maxServings, steps, allergens, color, и т.д.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_builder_config_category ON public.builder_config(category);
CREATE INDEX IF NOT EXISTS idx_builder_config_active ON public.builder_config(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_builder_config_sort ON public.builder_config(category, sort_order);

COMMENT ON TABLE public.builder_config IS 'Конфигурация конструктора десертов — управляется администратором';

ALTER TABLE public.builder_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "builder_config_read_all" ON public.builder_config FOR SELECT USING (true);
CREATE POLICY "builder_config_write_admin" ON public.builder_config FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN', 'SUPER_ADMIN') AND ur.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN', 'SUPER_ADMIN') AND ur.is_active = true));

-- ===== 2. builder_partner_offers — предложения партнёров =====
-- Кондитеры, кофейни, рестораны, кондитерские ателье предлагают
-- свои услуги через конструктор с указанием средней стоимости.
CREATE TABLE IF NOT EXISTS public.builder_partner_offers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  partner_id TEXT NOT NULL, -- user_id партнёра
  partner_type TEXT NOT NULL, -- 'confectioner' | 'atelier' | 'cafe' | 'restaurant' | 'shop'
  partner_name TEXT NOT NULL,
  partner_avatar TEXT,
  city TEXT,
  product_type TEXT, -- 'cake' | 'cupcakes' | 'macarons' | и т.д. (NULL = все типы)
  avg_price INTEGER, -- средняя стоимость в рублях
  min_price INTEGER, -- минимальная стоимость
  max_price INTEGER, -- максимальная стоимость
  rating NUMERIC DEFAULT 0,
  reviews_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  specialties TEXT[] DEFAULT '{}', -- ['wedding', 'birthday', 'chocolate', ...]
  metadata JSONB DEFAULT '{}', -- доп. данные (доставка, самовывоз, и т.д.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_offers_city ON public.builder_partner_offers(city);
CREATE INDEX IF NOT EXISTS idx_partner_offers_type ON public.builder_partner_offers(product_type);
CREATE INDEX IF NOT EXISTS idx_partner_offers_active ON public.builder_partner_offers(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_partner_offers_partner ON public.builder_partner_offers(partner_id);

COMMENT ON TABLE public.builder_partner_offers IS 'Предложения партнёров для конструктора десертов';

ALTER TABLE public.builder_partner_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_offers_read_all" ON public.builder_partner_offers FOR SELECT USING (true);
CREATE POLICY "partner_offers_write_owner" ON public.builder_partner_offers FOR ALL
  USING (partner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN', 'SUPER_ADMIN') AND ur.is_active = true))
  WITH CHECK (partner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN', 'SUPER_ADMIN') AND ur.is_active = true));

-- ===== 3. builder_decor_shops — магазины декора =====
-- Магазины, поставляющие декор для кондитерских изделий.
-- Админ может добавлять/редактировать магазины.
CREATE TABLE IF NOT EXISTS public.builder_decor_shops (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  description TEXT,
  logo TEXT, -- URL логотипа
  website TEXT, -- URL сайта
  city TEXT,
  delivery_cities TEXT[] DEFAULT '{}',
  avg_price_level TEXT DEFAULT 'medium', -- 'budget' | 'medium' | 'premium' | 'luxury'
  rating NUMERIC DEFAULT 0,
  reviews_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  categories TEXT[] DEFAULT '{}', -- ['berries', 'chocolate_curls', 'macarons', ...] — какие декоры поставляет
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decor_shops_city ON public.builder_decor_shops(city);
CREATE INDEX IF NOT EXISTS idx_decor_shops_active ON public.builder_decor_shops(is_active) WHERE is_active = true;

COMMENT ON TABLE public.builder_decor_shops IS 'Магазины декора для кондитерских изделий';

ALTER TABLE public.builder_decor_shops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "decor_shops_read_all" ON public.builder_decor_shops FOR SELECT USING (true);
CREATE POLICY "decor_shops_write_admin" ON public.builder_decor_shops FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN', 'SUPER_ADMIN') AND ur.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN', 'SUPER_ADMIN') AND ur.is_active = true));

-- ===== 4. Seed: базовая конфигурация конструктора =====
-- Заполняем builder_config системными опциями из mock-data
INSERT INTO public.builder_config (id, category, key, label, description, icon, price_modifier, sort_order, metadata) VALUES
  -- Типы изделий
  ('bc_cake', 'product_types', 'cake', 'Торт', 'Классический многоярусный или одноярусный торт', '🎂', 1500, 0, '{"unit":"порция","defaultServings":8,"minServings":4,"maxServings":100}'),
  ('bc_cupcakes', 'product_types', 'cupcakes', 'Капкейки', 'Маленькие кексы с кремом — набор от 6 штук', '🧁', 200, 1, '{"unit":"шт","defaultQuantity":12,"minQuantity":6,"maxQuantity":100}'),
  ('bc_macarons', 'product_types', 'macarons', 'Макаронс', 'Французское миндальное пирожное — набор от 8 штук', '🟡', 150, 2, '{"unit":"шт","defaultQuantity":16,"minQuantity":8,"maxQuantity":100}'),
  ('bc_pastries', 'product_types', 'pastries', 'Пирожные', 'Десерт в стакане или корзиночке — набор от 6 штук', '🍰', 250, 3, '{"unit":"шт","defaultQuantity":8,"minQuantity":6,"maxQuantity":50}'),
  ('bc_cookies', 'product_types', 'cookies', 'Печенье', 'Имбирное или песочное печенье — набор от 10 штук', '🍪', 80, 4, '{"unit":"шт","defaultQuantity":20,"minQuantity":10,"maxQuantity":200}'),
  ('bc_cheesecake', 'product_types', 'cheesecake', 'Чизкейк', 'Десерт на сливочном сыре — целиком или порционно', '🧀', 1800, 5, '{"unit":"порция","defaultServings":8,"minServings":4,"maxServings":30}'),
  ('bc_tart', 'product_types', 'tart', 'Тарт', 'Открытый пирог с фруктами или ягодами', '🥧', 1600, 6, '{"unit":"порция","defaultServings":8,"minServings":4,"maxServings":30}'),
  ('bc_mousse', 'product_types', 'mousse_cake', 'Муссовый торт', 'Многослойный муссовый десерт с зеркальной глазурью', '🍮', 2200, 7, '{"unit":"порция","defaultServings":8,"minServings":4,"maxServings":30}'),
  ('bc_brownies', 'product_types', 'brownies', 'Брауни', 'Шоколадное пирожное без выпечки — набор от 6 штук', '🍫', 180, 8, '{"unit":"шт","defaultQuantity":9,"minQuantity":6,"maxQuantity":50}'),
  ('bc_gingerbread', 'product_types', 'gingerbread', 'Пряники', 'Имбирные пряники с росписью — набор от 5 штук', '🔴', 120, 9, '{"unit":"шт","defaultQuantity":10,"minQuantity":5,"maxQuantity":100}'),
  -- Мероприятия
  ('bc_birthday', 'event_types', 'birthday', 'День рождения', 'Праздничный торт для именинника', '🎂', 0, 0, '{}'),
  ('bc_wedding', 'event_types', 'wedding', 'Свадьба', 'Многоярусный торт для торжества', '💍', 0, 1, '{}'),
  ('bc_kids', 'event_types', 'kids', 'Детский праздник', 'Яркий торт с любимыми героями', '🧸', 0, 2, '{}'),
  ('bc_corporate', 'event_types', 'corporate', 'Корпоратив', 'Для офисного праздника', '🏢', 0, 3, '{}'),
  ('bc_romantic', 'event_types', 'romantic', 'Романтический', 'Торт для двоих', '💕', 0, 4, '{}'),
  ('bc_just', 'event_types', 'just', 'Просто так', 'Угостить себя и близких', '🍰', 0, 5, '{}'),
  -- Декор
  ('bc_dec_berries', 'decorations', 'berries', 'Свежие ягоды', NULL, NULL, 400, 0, '{}'),
  ('bc_dec_choc', 'decorations', 'chocolate_curls', 'Шоколадная стружка', NULL, NULL, 150, 1, '{}'),
  ('bc_dec_macarons', 'decorations', 'macarons', 'Макаронс', NULL, NULL, 350, 2, '{}'),
  ('bc_dec_meringue', 'decorations', 'meringue', 'Безе', NULL, NULL, 300, 3, '{}'),
  ('bc_dec_flowers', 'decorations', 'sugar_flowers', 'Сахарные цветы', NULL, NULL, 800, 4, '{}'),
  ('bc_dec_fruit', 'decorations', 'fresh_fruit', 'Свежие фрукты', NULL, NULL, 350, 5, '{}'),
  ('bc_dec_gold', 'decorations', 'edible_gold', 'Сусальное золото', NULL, NULL, 600, 6, '{}'),
  ('bc_dec_wafer', 'decorations', 'wafer_paper', 'Вафельная бумага', NULL, NULL, 250, 7, '{}')
ON CONFLICT (id) DO NOTHING;
