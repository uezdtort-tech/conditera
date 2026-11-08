-- ============================================================================
-- 0067_recipe_ingredients_normalization.sql — RECIPE-02 (Этап B, RB.17/RA.17.3)
--
-- Нормализация `recipe_ingredients` (существующая таблица 0053:53):
--   • qty DROP NOT NULL            — «по вкусу»/«по необходимости» без числа;
--   • CHECK (qty IS NULL OR qty>0) — количество, если задано, положительно;
--   • display_qty TEXT             — «1/2 стакана», «по вкусу» (display-only);
--   • is_optional BOOL             — DEFAULT false;
--   • prep_note TEXT               — «нарезать пластинами 1 см»;
--   • group_title TEXT             — простые группы («Тесто», «Соусы») —
--                                    отдельная таблица групп НЕ создаётся (§F.3);
--   • position INT                 — канонический порядок (sort_order 0053
--                                    сохраняется для старых читателей на переход).
--
-- Правило количества/единиц (RECIPE-01A, §F.3): канон г/мл/шт; «ложка/стакан/
-- по вкусу» — display-only, автоконверсия масса↔объём запрещена (Q-2 RESOLVED).
-- Регресс-фильтр `qty IS NOT NULL` в breakdown существующих расчётов — кодовая
-- мера RECIPE-02/03, не SQL.
--
-- Перенос данных: НЕТ (RB.17). RLS: без изменений — латентная политика 0053
-- сохраняется до 0073 (RB.16).
--
-- Идемпотентность: ADD COLUMN IF NOT EXISTS; DROP NOT NULL — DO-гварда
-- pg_attribute.attnotnull (RB.17: «проверка pg_attribute.attnotnull»);
-- CHECK — DO-гварда pg_constraint.
-- ============================================================================

-- ============================================================================
-- 1. Новые колонки
-- ============================================================================
ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS display_qty TEXT,
  ADD COLUMN IF NOT EXISTS is_optional BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prep_note TEXT,
  ADD COLUMN IF NOT EXISTS group_title TEXT,
  ADD COLUMN IF NOT EXISTS position INT;

COMMENT ON COLUMN public.recipe_ingredients.display_qty IS 'RECIPE-02: display-only количество («1/2 стакана», «по вкусу»); без конверсии';
COMMENT ON COLUMN public.recipe_ingredients.is_optional IS 'RECIPE-02: опциональный ингредиент';
COMMENT ON COLUMN public.recipe_ingredients.prep_note IS 'RECIPE-02: подготовка ингредиента («нарезать пластинами 1 см»)';
COMMENT ON COLUMN public.recipe_ingredients.group_title IS 'RECIPE-02: простая группа ингредиентов («Тесто», «Соусы»)';
COMMENT ON COLUMN public.recipe_ingredients.position IS 'RECIPE-02: канонический порядок отображения';

-- ============================================================================
-- 2. qty DROP NOT NULL — DO-гварда pg_attribute (повторный прогон no-op)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.recipe_ingredients'::regclass
       AND attname = 'qty'
       AND attnotnull = true
  ) THEN
    ALTER TABLE public.recipe_ingredients ALTER COLUMN qty DROP NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 3. CHECK (qty IS NULL OR qty > 0) — DO-гварда pg_constraint
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recipe_ingredients_qty_check'
       AND conrelid = 'public.recipe_ingredients'::regclass
  ) THEN
    ALTER TABLE public.recipe_ingredients
      ADD CONSTRAINT recipe_ingredients_qty_check
      CHECK (qty IS NULL OR qty > 0);
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK PLAN (RA.17; выполняется вручную)
-- ============================================================================
-- ALTER TABLE public.recipe_ingredients DROP CONSTRAINT IF EXISTS recipe_ingredients_qty_check;
-- ВНИМАНИЕ: обратный ADD NOT NULL требует предварительной очистки NULL-qty:
--   DELETE FROM public.recipe_ingredients WHERE qty IS NULL;  -- либо бэкфилл значений
-- ALTER TABLE public.recipe_ingredients ALTER COLUMN qty SET NOT NULL;
-- ALTER TABLE public.recipe_ingredients
--   DROP COLUMN IF EXISTS position,
--   DROP COLUMN IF EXISTS group_title,
--   DROP COLUMN IF EXISTS prep_note,
--   DROP COLUMN IF EXISTS is_optional,
--   DROP COLUMN IF EXISTS display_qty;
