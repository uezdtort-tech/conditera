-- ============================================================================
-- 0068_recipe_marketplace_bridge.sql — RECIPE-02 (Этап B, RB.17/RA.17.4)
--
-- Мост «оффер → рецепт» (ПР-1 RECIPE-01A: единственный источник коммерции —
-- оффер; recipes.access_type не создаётся):
--   1. recipe_marketplace.recipe_id — новый FK → recipes(id) ON DELETE RESTRICT
--      (RB.13 прим.2: запрет hard-delete рецепта с оффером);
--   2. частичный UNIQUE: один активный (is_published) оффер на рецепт;
--   3. безопасный бэкфилл live-офферов → корневые строки recipes
--      (author/title/description/difficulty/servings-нет→NULL/tags/preview_image
--      →image_url/cooking_time_min→cook_time_minutes; content='' — MDX-тело
--      отсутствует, контент живёт в замороженном JSONB оффера до 0069);
--   4. защита содержимого: steps_json/ingredients_json НЕ очищаются —
--      замораживаются (метка legacy в COMMENT; читаются маппером до
--      переключения UI, RA.17.4);
--   5. пост-проверка целостности: RAISE при неполном переносе (fail-fast).
--
-- Идемпотентность (НФ-3/НФ-4):
--   • бэкфилл — ОДИН атомарный CTE-стейтмент (INSERT+UPDATE в одном стейтменте
--     нельзя оставить наполовину ни в autocommit, ни в транзакции);
--   • связка детерминирована: slug рецепты = 'offer-' || marketplace.slug
--     (marketplace.slug UNIQUE ⇒ коллизий нет; повторный прогон — no-op);
--   • остаток от гипотетического предыдущего сбоя самолечится (re-link по slug);
--   • FK/UNIQUE — DO-гварды / IF NOT EXISTS.
-- ============================================================================

-- ============================================================================
-- 1. Колонка recipe_id (nullable до бэкфилла)
-- ============================================================================
ALTER TABLE public.recipe_marketplace
  ADD COLUMN IF NOT EXISTS recipe_id UUID;

COMMENT ON COLUMN public.recipe_marketplace.recipe_id IS 'RECIPE-02: корневой рецепт оффера (ПР-1); FK RESTRICT — 0068';

-- ============================================================================
-- 2. Бэкфилл: live-офферы → recipes + связка. ОДИН атомарный CTE.
--    Повторный прогон: строки с recipe_id уже заполнены — INSERT пропустит
--    (slug-гварда), UPDATE не найдёт кандидатов — no-op.
-- ============================================================================
WITH ins AS (
  INSERT INTO public.recipes
    (author_id, title, description, content, difficulty,
     cook_time_minutes, tags, image_url,
     status, published_at, slug, legacy_content_mdx)
  SELECT
    m.author_id,
    m.title,
    m.description,
    '',                        -- MDX-тело отсутствует; состав — в замороженном JSONB (0069)
    CASE
      WHEN m.difficulty BETWEEN 1 AND 2 THEN 'easy'
      WHEN m.difficulty = 3     THEN 'medium'
      WHEN m.difficulty >= 4    THEN 'hard'
      ELSE NULL
    END,
    m.cooking_time_min,
    COALESCE(m.tags, '{}'),
    m.preview_image,
    CASE WHEN m.is_published THEN 'published' ELSE 'draft' END,
    m.published_at,
    'offer-' || m.slug,        -- детерминированный ключ связки (уникален: m.slug UNIQUE)
    true                       -- RB.17 0068: бэкфилл-строки помечены legacy_content_mdx
  FROM public.recipe_marketplace m
  WHERE m.recipe_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.recipes r
       WHERE r.slug = 'offer-' || m.slug
    )
  RETURNING id, slug
)
UPDATE public.recipe_marketplace m
   SET recipe_id = ins.id
  FROM ins
 WHERE ins.slug = 'offer-' || m.slug;

-- Самолечение остатка гипотетического сбоя ДО CTE невозможно ретроактивно —
-- поэтому повторный re-link по детерминированному slug выполняется отдельно
-- (no-op в нормальном случае):
UPDATE public.recipe_marketplace m
   SET recipe_id = r.id
  FROM public.recipes r
 WHERE m.recipe_id IS NULL
   AND r.slug = 'offer-' || m.slug
   AND r.legacy_content_mdx = true;

-- ============================================================================
-- 3. Пост-проверка целостности (fail-fast: не прячем неполный результат)
-- ============================================================================
DO $$
DECLARE
  v_unlinked INT;
BEGIN
  SELECT count(*) INTO v_unlinked
    FROM public.recipe_marketplace
   WHERE recipe_id IS NULL;
  IF v_unlinked > 0 THEN
    RAISE EXCEPTION '[0068] % офферов остались без recipe_id после бэкфилла — проверьте slug-конфликты (см. ROLLBACK PLAN)', v_unlinked
      USING HINT = 'Каждый оффер обязан ссылаться на корневой рецепт (RB.13). Разрешите конфликт вручную и перезапустите миграцию.';
  END IF;
END $$;

-- ============================================================================
-- 4. FK RESTRICT — DO-гварда pg_constraint
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_recipe_marketplace_recipe'
       AND conrelid = 'public.recipe_marketplace'::regclass
  ) THEN
    ALTER TABLE public.recipe_marketplace
      ADD CONSTRAINT fk_recipe_marketplace_recipe
      FOREIGN KEY (recipe_id)
      REFERENCES public.recipes (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ============================================================================
-- 5. Один активный оффер на рецепт — частичный UNIQUE (RB.13 прим.1)
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_marketplace_active_recipe
  ON public.recipe_marketplace (recipe_id)
  WHERE is_published = true AND recipe_id IS NOT NULL;

-- ============================================================================
-- 6. Заморозка JSONB-источников (RA.17.4: помечаются legacy, не удаляются)
-- ============================================================================
COMMENT ON COLUMN public.recipe_marketplace.steps_json IS
  'RECIPE-02: legacy — заморожено; источник нормализации 0069 (recipe_steps); читается маппером до переключения UI';
COMMENT ON COLUMN public.recipe_marketplace.ingredients_json IS
  'RECIPE-02: legacy — заморожено; источник нормализации 0069 (recipe_ingredients); читается маппером до переключения UI';

-- ============================================================================
-- ROLLBACK PLAN (RA.17; выполняется вручную, порядок обратный применению)
-- ============================================================================
-- COMMENT ON COLUMN public.recipe_marketplace.ingredients_json IS NULL;
-- COMMENT ON COLUMN public.recipe_marketplace.steps_json IS NULL;
-- DROP INDEX IF EXISTS uq_recipe_marketplace_active_recipe;
-- ALTER TABLE public.recipe_marketplace DROP CONSTRAINT IF EXISTS fk_recipe_marketplace_recipe;
-- ВНИМАНИЕ: откат бэкфилла удаляет созданные корневые строки (связанные
-- офферы возвращаются в recipe_id IS NULL). Пользовательских правок в этих
-- строках быть не должно (созданы миграцией, помечены legacy_content_mdx):
-- DELETE FROM public.recipes
--  WHERE legacy_content_mdx = true
--    AND slug LIKE 'offer-%'
--    AND NOT EXISTS (SELECT 1 FROM public.recipe_purchases p WHERE p.recipe_id = recipes.id);
-- ALTER TABLE public.recipe_marketplace DROP COLUMN IF EXISTS recipe_id;
