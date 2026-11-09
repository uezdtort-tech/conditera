-- ============================================================================
-- 0075_recipe_purchases_recipe_fk_fix.sql — RECIPE-03 (дефект, найден
-- браузерной верификацией золотого пути «покупка → платёж → entitlement»).
--
-- ДЕФЕКТ: legacy FK 0012 `recipe_purchases_recipe_id_fkey` ссылается на
-- recipe_marketplace(id) (смысл: «id оффера»). Контракт РЕШ-6 (RB.13/0072)
-- переосмысляет recipe_purchases как entitlement-состояние с
-- UNIQUE(recipe_id, buyer_id), где recipe_id = recipes.id (uuid корня
-- рецепта): покупка создаётся по offer.recipe_id, Resolver/entitlement/
-- webhook/versions — везде recipes.id. Прежний FK делал КАЖДУЮ выдачу
-- права невозможной:
--   [entitlement] grant failed: violates foreign key constraint
--   "recipe_purchases_recipe_id_fkey"
--
-- ФИКС (минимальный, только конкретный дефект):
--   • legacy FK на recipe_marketplace удаляется (по conname + confrelid —
--     не трогаем чужие имена);
--   • новый FK fk_recipe_purchases_recipe → recipes(id) ON DELETE RESTRICT —
--     РЕШ-6 п.7: hard DELETE рецепта при наличии покупок запрещён
--     (RESTRICT + soft-archive через recipes.status='archived').
--
-- Перенос данных: НЕ требуется (RB.17: 0 строк на момент 0072; fail-fast
-- гвардой запрещаем применение при «висячих» recipe_id — конфликт реальных
-- данных = fail-fast, не прятать).
--
-- Идемпотентность (двойной мигратор: локальный setup.mjs — транзакция/файл;
-- prod psql — autocommit, statement-by-statement): каждый statement
-- rerun-safe; FK — DO-гварды pg_catalog (conname + confrelid).
-- GRANT: новые не выдаются (RLS — дверь; supabaseAdmin/service_role — путь записи).
--
-- ROLLBACK PLAN:
--   ALTER TABLE public.recipe_purchases DROP CONSTRAINT IF EXISTS fk_recipe_purchases_recipe;
--   ALTER TABLE public.recipe_purchases
--     ADD CONSTRAINT recipe_purchases_recipe_id_fkey
--     FOREIGN KEY (recipe_id) REFERENCES public.recipe_marketplace(id) ON DELETE CASCADE;
--   (возврат к состоянию 0012; при наличии строк с recipes.id откат
--   потребует их удаления — решение владельца, данными не жертвуем молча).
-- ============================================================================

-- ============================================================================
-- 1. Fail-fast: «висячие» recipe_id (не recipes.id) — применение запрещено
-- ============================================================================
DO $$
DECLARE
  v_orphan INT;
BEGIN
  SELECT count(*) INTO v_orphan
    FROM public.recipe_purchases p
   WHERE NOT EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = p.recipe_id);
  IF v_orphan > 0 THEN
    RAISE EXCEPTION
      '0075: % строк recipe_purchases с recipe_id, отсутствующим в recipes — перенос данных обязателен до смены FK (fail-fast)', v_orphan;
  END IF;
END $$;

-- ============================================================================
-- 2. Удалить legacy FK → recipe_marketplace (точечно, по имени и цели)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recipe_purchases_recipe_id_fkey'
       AND conrelid = 'public.recipe_purchases'::regclass
       AND confrelid = 'public.recipe_marketplace'::regclass
  ) THEN
    ALTER TABLE public.recipe_purchases
      DROP CONSTRAINT recipe_purchases_recipe_id_fkey;
  END IF;
END $$;

-- ============================================================================
-- 3. Новый FK → recipes(id), ON DELETE RESTRICT (РЕШ-6 п.7)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_recipe_purchases_recipe'
       AND conrelid = 'public.recipe_purchases'::regclass
  ) THEN
    ALTER TABLE public.recipe_purchases
      ADD CONSTRAINT fk_recipe_purchases_recipe
      FOREIGN KEY (recipe_id)
      REFERENCES public.recipes (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON CONSTRAINT fk_recipe_purchases_recipe ON public.recipe_purchases IS
  'RECIPE-03 (0075): entitlement привязан к корню recipes (РЕШ-6); RESTRICT — hard DELETE рецепта с покупками запрещён, РЕШ-6 п.7';
