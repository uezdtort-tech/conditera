-- ============================================================================
-- 0065_recipes_content_extension.sql — RECIPE-02 (Этап B, RB.17/RA.17.1)
--
-- Расширение корня контентной модели: `recipes` (существующая таблица 0010).
--
-- Состав (спецификация RECIPE-01B RB.17, строка 0065; §F.1 минус `access_type`,
-- минус `source_*`-денормализация — ПР-1 RECIPE-01A):
--   • subtitle        — короткая подводка;
--   • allergens       — TEXT[] кодов (milk/eggs/gluten/nuts/peanuts/soy/fish/
--                       shellfish/sesame);
--   • equipment       — TEXT[] («сковорода», «миксер» и т.п.);
--   • yield_text      — человекочитаемый выход («выход: 12 пластин»);
--   • storage_note    — условия хранения / срок;
--   • legacy_content_mdx — метка контентного контура I (MDX-наследие);
--   • CHECK-словарь статусов: draft/pending_review/published/rejected/archived
--     (существующие значения 'published'/'draft'/'archived' сохраняются);
--   • индексы: (status, published_at DESC), GIN tags, pg_trgm по title;
--   • RLS: политика админа (UPDATE any) — для модерации (RB.15: модератор
--     pending_review→published/rejected).
--
-- Денег в миграции нет (RECIPE-02: целые рубли — канон RB.12/Q-9; цена живёт
-- в оффере recipe_marketplace).
--
-- Идемпотентность (контракт RB.17, НФ-3/НФ-4):
--   каждый стейтмент rerun-safe: ADD COLUMN IF NOT EXISTS, CREATE INDEX
--   IF NOT EXISTS, UPDATE c WHERE-гвардом, CHECK/FK — только через DO-гварду
--   pg_constraint (после частичного autocommit-сбоя повторный прогон
--   достраивает недостающее и не падает на существующем).
-- ============================================================================

-- ============================================================================
-- 1. Новые колонки (аддитивно, NOT NULL на существующие данные не навешивается)
-- ============================================================================
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS subtitle TEXT,
  ADD COLUMN IF NOT EXISTS allergens TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS equipment TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS yield_text TEXT,
  ADD COLUMN IF NOT EXISTS storage_note TEXT,
  ADD COLUMN IF NOT EXISTS legacy_content_mdx BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recipes.subtitle IS 'RECIPE-02: короткая подводка карточки';
COMMENT ON COLUMN public.recipes.allergens IS 'RECIPE-02: коды аллергенов (milk/eggs/gluten/nuts/peanuts/soy/fish/shellfish/sesame)';
COMMENT ON COLUMN public.recipes.equipment IS 'RECIPE-02: необходимое оборудование (TEXT[])';
COMMENT ON COLUMN public.recipes.yield_text IS 'RECIPE-02: человекочитаемый выход продукта';
COMMENT ON COLUMN public.recipes.storage_note IS 'RECIPE-02: условия хранения и срок';
COMMENT ON COLUMN public.recipes.legacy_content_mdx IS 'RECIPE-02: true — контент унаследован из MDX-контура/бэкфилла 0068';

-- ============================================================================
-- 2. Бэкфилл статусов: неканонические/NULL значения → 'draft'
--    (существующие 'published'/'draft'/'archived' сохраняются — WHERE NOT IN)
-- ============================================================================
UPDATE public.recipes
   SET status = 'draft'
 WHERE (status IS NULL OR status NOT IN
          ('draft','pending_review','published','rejected','archived'));

-- ============================================================================
-- 3. CHECK-словарь статусов — только через DO-гварду pg_constraint
--    (голый ADD CONSTRAINT после частичного prod-сбоя уронит повторный прогон)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recipes_status_check'
       AND conrelid = 'public.recipes'::regclass
  ) THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_status_check
      CHECK (status IN ('draft','pending_review','published','rejected','archived'));
  END IF;
END $$;

-- ============================================================================
-- 4. Индексы (все IF NOT EXISTS; GIN tags уже существует с 0010 — тот же
--    стейтмент с тем же именем является no-op и оставлен для самодостаточности
--    файла; pg_trgm подключён в 0001, прецедент 0002 idx_products_title_trgm)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_recipes_status_published
  ON public.recipes (status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_recipes_tags
  ON public.recipes USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_recipes_title_trgm
  ON public.recipes USING GIN (title gin_trgm_ops);

-- ============================================================================
-- 5. RLS: политика админа/модератора (UPDATE any) — DO-гварда pg_policies
--    (модерация RB.15: pending_review→published/rejected выполняется
--    модератором; существующие recipes_select_public/insert_own/update_own
--    из 0010 не изменяются — сужение политик выполняет 0073, не RECIPE-02)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'recipes'
       AND policyname = 'recipes_update_admin'
  ) THEN
    CREATE POLICY "recipes_update_admin" ON public.recipes
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      );
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK PLAN (RA.17: блок обязателен в каждом файле; выполняется вручную
-- при откате, порядок — обратный применению)
-- ============================================================================
-- DROP POLICY IF EXISTS "recipes_update_admin" ON public.recipes;
-- DROP INDEX IF EXISTS idx_recipes_title_trgm;
-- DROP INDEX IF EXISTS idx_recipes_tags;          -- опционально: восстановит 0010-эквивалент
-- DROP INDEX IF EXISTS idx_recipes_status_published;
-- ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_status_check;
-- ALTER TABLE public.recipes
--   DROP COLUMN IF EXISTS legacy_content_mdx,
--   DROP COLUMN IF EXISTS storage_note,
--   DROP COLUMN IF EXISTS yield_text,
--   DROP COLUMN IF EXISTS equipment,
--   DROP COLUMN IF EXISTS allergens,
--   DROP COLUMN IF EXISTS subtitle;
