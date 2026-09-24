-- 0021_holidays_events.sql
-- ============================================================================
-- Таблица праздников и событий для подбора кондитерских изделий по событиям.
--
-- Содержит:
--   • Федеральные праздники РФ (Новый год, 8 марта, 23 февраля и т.д.)
--   • Религиозные праздники (Рождество, Пасха, Курбан-байрам, Ураза-байрам)
--   • Профессиональные праздники (День медика, День учителя, и т.д.)
--   • Дни городов (Москва, Санкт-Петербург, Казань, и т.д.)
--   • Международные праздники (День матери, День святого Валентина)
--
-- Кондитеры могут создавать изделия привязанные к конкретному празднику.
-- Конструктор предлагает типы изделий в зависимости от выбранного события.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  -- Тип праздника
  holiday_type TEXT NOT NULL DEFAULT 'federal'
    CHECK (holiday_type IN ('federal', 'religious', 'professional', 'city_day', 'international', 'school', 'family', 'custom')),
  -- Дата: либо фиксированная (month+day), либо плавающая (вычисляется)
  month INTEGER,  -- 1-12 (NULL для плавающих дат)
  day INTEGER,    -- 1-31
  is_floating BOOLEAN DEFAULT FALSE,  -- TRUE для Пасхи, Дня матери и т.д.
  floating_calc TEXT,  -- Формула вычисления (например, 'easter', 'second_sunday_may')
  -- Локализация
  region TEXT,  -- NULL = вся Россия, иначе код региона/города
  city TEXT,    -- Конкретный город (для дней городов)
  -- Категория для подбора типа изделия
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('birthday', 'wedding', 'kids', 'corporate', 'romantic', 'newyear', 'christmas', 'easter', 'valentine', 'march8', 'feb23', 'memorial', 'graduation', 'babyshower', 'engagement', 'housewarming', 'professional', 'city_day', 'school', 'family', 'general')),
  -- Рекомендуемые типы изделий
  recommended_product_types TEXT[] DEFAULT '{}',  -- ['cake', 'cupcakes', 'gingerbread']
  -- Иконка для UI
  icon TEXT DEFAULT '🎉',
  -- Сезонность
  is_seasonal BOOLEAN DEFAULT FALSE,
  season_months INTEGER[] DEFAULT '{}',
  -- Метаданные
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT chk_date CHECK (
    (month IS NOT NULL AND day IS NOT NULL AND month BETWEEN 1 AND 12 AND day BETWEEN 1 AND 31)
    OR (is_floating = TRUE AND floating_calc IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_holidays_month_day ON public.holidays(month, day) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_holidays_category ON public.holidays(category);
CREATE INDEX IF NOT EXISTS idx_holidays_type ON public.holidays(holiday_type);
CREATE INDEX IF NOT EXISTS idx_holidays_region ON public.holidays(region) WHERE region IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_holidays_active ON public.holidays(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_holidays_sort ON public.holidays(sort_order);

COMMENT ON TABLE public.holidays IS 'Праздники и события РФ — для подбора кондитерских изделий по событиям';
COMMENT ON COLUMN public.holidays.holiday_type IS 'federal | religious | professional | city_day | international | school | family | custom';
COMMENT ON COLUMN public.holidays.is_floating IS 'TRUE для плавающих дат (Пасха, День матери)';
COMMENT ON COLUMN public.holidays.floating_calc IS 'Алгоритм вычисления: easter, second_sunday_may, last_sunday_march, и т.д.';
COMMENT ON COLUMN public.holidays.region IS 'NULL = вся Россия, иначе код региона';
COMMENT ON COLUMN public.holidays.recommended_product_types IS 'Массив ID типов изделий: cake, cupcakes, gingerbread, и т.д.';

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holidays_select_all" ON public.holidays FOR SELECT USING (true);
CREATE POLICY "holidays_write_admin" ON public.holidays FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
      AND ur.is_active = true
  )
);

-- ============================================================================
-- SEED: Праздники России
-- ============================================================================

INSERT INTO public.holidays (name, description, holiday_type, month, day, category, icon, sort_order) VALUES
-- Федеральные праздники
('Новый год', 'Главный праздник года — ёлка, подарки, шампанское', 'federal', 1, 1, 'newyear', '🎄', 1),
('Рождество Христово', 'Православный праздник — Рождественский сочельник', 'religious', 1, 7, 'christmas', '🕯️', 2),
('Старый Новый год', 'Традиционный праздник по юлианскому календарю', 'family', 1, 14, 'newyear', '🎉', 3),
('Крещение Господне', 'Православный праздник', 'religious', 1, 19, 'christmas', '✨', 4),
('День святого Валентина', 'День влюблённых — романтический праздник', 'international', 2, 14, 'valentine', '💝', 5),
('День защитника Отечества', 'Мужской праздник — 23 февраля', 'federal', 2, 23, 'feb23', '🎖️', 6),
('Масленица (плавающая)', 'Проводы зимы — блины и ярмарки', 'religious', NULL, NULL, 'general', '🥞', 7, 'is_floating', true, 'floating_calc', 'maslenitsa'),
('Международный женский день', 'Весенний праздник — 8 марта', 'federal', 3, 8, 'march8', '🌷', 8),
('День космонавтики', 'День космонавтики — 12 апреля', 'federal', 4, 12, 'general', '🚀', 9),
('Пасха (плавающая)', 'Христово Воскресение — куличи и яйца', 'religious', NULL, NULL, 'easter', '🥚', 10, 'is_floating', true, 'floating_calc', 'easter'),
('Красная горка', 'Первое воскресенье после Пасхи — свадьбы', 'religious', NULL, NULL, 'wedding', '💒', 11, 'is_floating', true, 'floating_calc', 'first_sunday_after_easter'),
('Праздник Весны и Труда', '1 Мая — День труда', 'federal', 5, 1, 'general', '🌿', 12),
('День Победы', '9 мая — День Победы в Великой Отечественной войне', 'federal', 5, 9, 'memorial', '🎖️', 13),
('День России', '12 июня — национальный праздник', 'federal', 6, 12, 'general', '🇷🇺', 14),
('День народного единства', '4 ноября — государственный праздник', 'federal', 11, 4, 'general', '🤝', 15),
('День матери', 'Последнее воскресенье ноября', 'international', NULL, NULL, 'family', '❤️', 16, 'is_floating', true, 'floating_calc', 'last_sunday_november'),
('День знаний', '1 сентября — начало учебного года', 'school', 9, 1, 'school', '📚', 17),
('День учителя', '5 октября — профессиональный праздник', 'professional', 10, 5, 'professional', '🍎', 18),
('День медика', 'Первый понедельник октября', 'professional', NULL, NULL, 'professional', '⚕️', 19, 'is_floating', true, 'floating_calc', 'first_monday_october'),
('Хэллоуин', 'Канун Дня всех святых — 31 октября', 'international', 10, 31, 'kids', '🎃', 20),
('День отца', 'Третье воскресенье октября', 'family', NULL, NULL, 'family', '👨', 21, 'is_floating', true, 'floating_calc', 'third_sunday_october'),
('Предновогний вечер', '31 декабря — подготовка к Новому году', 'family', 12, 31, 'newyear', '🎆', 22)

ON CONFLICT DO NOTHING;

-- Дни городов России
INSERT INTO public.holidays (name, description, holiday_type, month, day, category, icon, region, city, sort_order) VALUES
('День города Москвы', 'Столица России — День города', 'city_day', 9, 5, 'city_day', '🏙️', 'MOW', 'Москва', 100),
('День города Санкт-Петербурга', 'Северная столица — День города', 'city_day', 5, 27, 'city_day', '🌉', 'SPE', 'Санкт-Петербург', 101),
('День города Казани', 'Столица Татарстана', 'city_day', 8, 30, 'city_day', '🏰', 'TA', 'Казань', 102),
('День города Екатеринбурга', 'Столица Урала', 'city_day', 8, 18, 'city_day', '⛰️', 'SVE', 'Екатеринбург', 103),
('День города Новосибирска', 'Столица Сибири', 'city_day', 6, 28, 'city_day', '🌲', 'NVS', 'Новосибирск', 104),
('День города Краснодара', 'Столица Юга', 'city_day', 9, 24, 'city_day', '🌻', 'KDA', 'Краснодар', 105),
('День города Нижнего Новгорода', 'Город на Волге', 'city_day', 9, 19, 'city_day', ' ⚓', 'NIZ', 'Нижний Новгород', 106),
('День города Самары', 'Город на Волге', 'city_day', 9, 12, 'city_day', '🚀', 'SAM', 'Самара', 107),
('День города Ростова-на-Дону', 'Южная столица', 'city_day', 9, 15, 'city_day', '🌾', 'RND', 'Ростов-на-Дону', 108),
('День города Уфы', 'Столица Башкортостана', 'city_day', 8, 7, 'city_day', '🏔️', 'BA', 'Уфа', 109),
('День города Челябинска', 'Город в Южном Урале', 'city_day', 9, 12, 'city_day', '🏭', 'CHE', 'Челябинск', 110),
('День города Волгограда', 'Город-герой', 'city_day', 7, 10, 'city_day', '🎖️', 'VGG', 'Волгоград', 111),
('День города Воронежа', 'Город у Дона', 'city_day', 9, 15, 'city_day', '⭐', 'VOR', 'Воронеж', 112),
('День города Перми', 'Город у Камы', 'city_day', 6, 12, 'city_day', '🌲', 'PER', 'Пермь', 113),
('День города Тюмени', 'Столица нефтегазового края', 'city_day', 7, 28, 'city_day', '🛢️', 'TYU', 'Тюмень', 114)

ON CONFLICT DO NOTHING;

-- Рекомендуемые типы изделий для популярных праздников
UPDATE public.holidays SET recommended_product_types = ARRAY['cake', 'cupcakes', 'gingerbread'] WHERE name = 'Новый год';
UPDATE public.holidays SET recommended_product_types = ARRAY['cake', 'pastries', 'gingerbread'] WHERE name = 'Рождество Христово';
UPDATE public.holidays SET recommended_product_types = ARRAY['cake', 'cupcakes', 'chocolate'] WHERE name = 'День святого Валентина';
UPDATE public.holidays SET recommended_product_types = ARRAY['cake', 'cupcakes', 'brownies'] WHERE name = 'День защитника Отечества';
UPDATE public.holidays SET recommended_product_types = ARRAY['cake', 'macarons', 'zephyr_bouquets'] WHERE name = 'Международный женский день';
UPDATE public.holidays SET recommended_product_types = ARRAY['cakes', 'pies', 'patties'] WHERE name = 'Пасха' OR name LIKE 'Пасха%';
UPDATE public.holidays SET recommended_product_types = ARRAY['cake', 'realistic_cakes', 'cupcakes'] WHERE name = 'День Победы';
UPDATE public.holidays SET recommended_product_types = ARRAY['cake', 'gingerbread', 'cookies'] WHERE name = 'День знаний';
UPDATE public.holidays SET recommended_product_types = ARRAY['cake', 'gingerbread', 'realistic_cakes'] WHERE name LIKE 'День города%';
UPDATE public.holidays SET recommended_product_types = ARRAY['cake', 'cupcakes', 'chocolate'] WHERE name = 'День матери';
