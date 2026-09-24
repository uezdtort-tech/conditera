-- 0022_confectioner_capabilities.sql
-- ============================================================================
-- Способности кондитеров — связываются с параметрами конструктора изделий.
--
-- Каждая запись описывает, что кондитер умеет делать:
--   • product_types — какие типы изделий (cake, cupcakes, macarons, ...)
--   • fillings — какие начинки использует (ссылки на public.fillings)
--   • bases — какие основы делает (sponge, mousse, cheesecake, ...)
--   • coatings — какие покрытия (cream_cheese, ganache_white, ...)
--   • shapes — какие формы (round, square, heart, sphere, book, ...)
--   • max_tiers — максимальное количество ярусов (1-4)
--   • dietary — диетические/антиаллергенные возможности
--   • decorations — какие виды декора делает
--
-- На основании этих данных работает поиск: когда пользователь выбирает
-- параметры в конструкторе, система находит кондитеров, которые способны
-- изготовить изделие с этими параметрами.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.confectioner_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confectioner_id TEXT NOT NULL,

  -- Типы изделий, которые кондитер умеет делать
  -- (значения из CAKE_BUILDER_OPTIONS.productTypes[].id)
  product_types TEXT[] DEFAULT '{}' NOT NULL,
  -- Примеры: ['cake', 'cupcakes', 'macarons', 'bento', 'gingerbread']

  -- Основы, которые кондитер умеет делать
  -- (значения из CAKE_BUILDER_OPTIONS.bases[].id)
  bases TEXT[] DEFAULT '{}' NOT NULL,
  -- Примеры: ['sponge', 'mousse', 'honey', 'red_velvet', 'biscuit']

  -- Начинки, которые использует кондитер
  -- (UUID из public.fillings.id — только APPROVED)
  filling_ids TEXT[] DEFAULT '{}' NOT NULL,
  -- Примеры: ['uuid1', 'uuid2', ...] — ссылка на public.fillings

  -- Покрытия, которые использует кондитер
  -- (значения из CAKE_BUILDER_OPTIONS.coatings[].id)
  coatings TEXT[] DEFAULT '{}' NOT NULL,
  -- Примеры: ['cream_cheese', 'ganache_white', 'mirror_glaze', 'mastic']

  -- Формы изделий, которые умеет делать
  -- (значения из CAKE_BUILDER_OPTIONS.shapes[].id)
  shapes TEXT[] DEFAULT '{}' NOT NULL,
  -- Примеры: ['round', 'square', 'heart', 'sphere', 'book', 'number']

  -- Максимальное количество ярусов (1-4)
  max_tiers INTEGER NOT NULL DEFAULT 1 CHECK (max_tiers BETWEEN 1 AND 4),

  -- Декор, который делает кондитер
  -- (значения из CAKE_BUILDER_OPTIONS.decorations[].id)
  decorations TEXT[] DEFAULT '{}' NOT NULL,
  -- Примеры: ['berries', 'chocolate_curls', 'macarons', 'edible_print']

  -- Диетические и антиаллергенные возможности
  dietary TEXT[] DEFAULT '{}' NOT NULL,
  -- Примеры: ['sugar_free', 'gluten_free', 'lactose_free', 'vegan', 'keto', 'nut_free', 'egg_free', 'dye_free']

  -- Дополнительные навыки (расширенные)
  additional_skills TEXT[] DEFAULT '{}' NOT NULL,
  -- Примеры: ['3d_modeling', 'sugar_flowers', 'airbrush', 'chocolate_sculpture', 'isomalt', 'wafer_paper']

  -- Доставка
  self_pickup BOOLEAN DEFAULT true,
  self_delivery BOOLEAN DEFAULT false,
  courier_delivery BOOLEAN DEFAULT true,
  russia_delivery BOOLEAN DEFAULT false,

  -- Минимальный заказ (в копейках)
  min_order_amount INTEGER DEFAULT 0,

  -- Срок изготовления (в днях)
  min_prep_days INTEGER DEFAULT 2,
  max_prep_days INTEGER DEFAULT 7,

  -- Метаданные
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT fk_confectioner FOREIGN KEY (confectioner_id)
    REFERENCES public.confectioners(id) ON DELETE CASCADE
);

-- Индексы для быстрого поиска по способностям
CREATE INDEX IF NOT EXISTS idx_cap_confectioner ON public.confectioner_capabilities(confectioner_id);
CREATE INDEX IF NOT EXISTS idx_cap_product_types ON public.confectioner_capabilities USING GIN (product_types);
CREATE INDEX IF NOT EXISTS idx_cap_bases ON public.confectioner_capabilities USING GIN (bases);
CREATE INDEX IF NOT EXISTS idx_cap_filling_ids ON public.confectioner_capabilities USING GIN (filling_ids);
CREATE INDEX IF NOT EXISTS idx_cap_coatings ON public.confectioner_capabilities USING GIN (coatings);
CREATE INDEX IF NOT EXISTS idx_cap_shapes ON public.confectioner_capabilities USING GIN (shapes);
CREATE INDEX IF NOT EXISTS idx_cap_dietary ON public.confectioner_capabilities USING GIN (dietary);
CREATE INDEX IF NOT EXISTS idx_cap_decorations ON public.confectioner_capabilities USING GIN (decorations);
CREATE INDEX IF NOT EXISTS idx_cap_max_tiers ON public.confectioner_capabilities(max_tiers);
CREATE INDEX IF NOT EXISTS idx_cap_active ON public.confectioner_capabilities(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE public.confectioner_capabilities IS 'Способности кондитеров — связываются с параметрами конструктора изделий для поиска';
COMMENT ON COLUMN public.confectioner_capabilities.product_types IS 'Массив ID типов изделий: cake, cupcakes, macarons, bento, и т.д.';
COMMENT ON COLUMN public.confectioner_capabilities.bases IS 'Массив ID основ: sponge, mousse, cheesecake, honey, red_velvet, biscuit';
COMMENT ON COLUMN public.confectioner_capabilities.filling_ids IS 'Массив UUID начинок из public.fillings (только APPROVED)';
COMMENT ON COLUMN public.confectioner_capabilities.coatings IS 'Массив ID покрытий: cream_cheese, ganache_white, ganache_dark, и т.д.';
COMMENT ON COLUMN public.confectioner_capabilities.shapes IS 'Массив ID форм: round, square, heart, sphere, book, number, letter, custom';
COMMENT ON COLUMN public.confectioner_capabilities.max_tiers IS 'Максимальное количество ярусов (1-4)';
COMMENT ON COLUMN public.confectioner_capabilities.dietary IS 'Диетические возможности: sugar_free, gluten_free, lactose_free, vegan, keto, nut_free, egg_free, dye_free';
COMMENT ON COLUMN public.confectioner_capabilities.additional_skills IS 'Дополнительные навыки: 3d_modeling, sugar_flowers, airbrush, chocolate_sculpture, isomalt, wafer_paper';

-- RLS: кондитер видит/редактирует свои способности, все видят чужие (для поиска)
ALTER TABLE public.confectioner_capabilities ENABLE ROW LEVEL SECURITY;

-- Публичное чтение — нужно для поиска
DROP POLICY IF EXISTS "cap_select_all" ON public.confectioner_capabilities;
CREATE POLICY "cap_select_all" ON public.confectioner_capabilities
  FOR SELECT USING (true);

-- Вставлять/обновлять — только владелец (кондитер) или админ
DROP POLICY IF EXISTS "cap_insert_own" ON public.confectioner_capabilities;
CREATE POLICY "cap_insert_own" ON public.confectioner_capabilities
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

DROP POLICY IF EXISTS "cap_update_own" ON public.confectioner_capabilities;
CREATE POLICY "cap_update_own" ON public.confectioner_capabilities
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

DROP POLICY IF EXISTS "cap_delete_own" ON public.confectioner_capabilities;
CREATE POLICY "cap_delete_own" ON public.confectioner_capabilities
  FOR DELETE USING (
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
-- SEED: Демо-способности для существующих кондитеров
-- ============================================================================

-- Получаем ID первого кондитера из mock-данных и создаём ему способности
INSERT INTO public.confectioner_capabilities (confectioner_id, product_types, bases, coatings, shapes, max_tiers, dietary, decorations, additional_skills, min_order_amount, min_prep_days, max_prep_days)
SELECT
  c.id,
  ARRAY['cake', 'cupcakes', 'bento', 'mousse_cake', 'pastries', 'brownies']::TEXT[],
  ARRAY['sponge', 'mousse', 'red_velvet']::TEXT[],
  ARRAY['cream_cheese', 'ganache_white', 'ganache_dark', 'mirror_glaze']::TEXT[],
  ARRAY['round', 'square', 'heart', 'sphere']::TEXT[],
  3,
  ARRAY['sugar_free', 'gluten_free']::TEXT[],
  ARRAY['berries', 'chocolate_curls', 'macarons', 'edible_print']::TEXT[],
  ARRAY['sugar_flowers', 'airbrush']::TEXT[],
  150000,  -- 1500 ₽
  2,
  5
FROM public.confectioners c
WHERE c.id = (SELECT id FROM public.confectioners LIMIT 1)
ON CONFLICT DO NOTHING;

-- Второму кондитеру — другие способности
INSERT INTO public.confectioner_capabilities (confectioner_id, product_types, bases, coatings, shapes, max_tiers, dietary, decorations, additional_skills, min_order_amount, min_prep_days, max_prep_days)
SELECT
  c.id,
  ARRAY['cake', 'macarons', 'gingerbread', 'cookies', 'realistic_cakes']::TEXT[],
  ARRAY['sponge', 'biscuit', 'honey']::TEXT[],
  ARRAY['cream_cheese', 'mastic', 'velvet_spray']::TEXT[],
  ARRAY['round', 'square', 'number', 'letter', 'custom']::TEXT[],
  2,
  ARRAY['nut_free', 'egg_free', 'dye_free']::TEXT[],
  ARRAY['edible_print', 'chocolate_curls', 'macarons']::TEXT[],
  ARRAY['3d_modeling', 'wafer_paper']::TEXT[],
  200000,  -- 2000 ₽
  3,
  7
FROM public.confectioners c
WHERE c.id = (SELECT id FROM public.confectioners OFFSET 1 LIMIT 1)
ON CONFLICT DO NOTHING;
