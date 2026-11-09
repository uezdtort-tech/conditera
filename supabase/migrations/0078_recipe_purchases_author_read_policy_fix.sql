-- ============================================================================
-- 0078_recipe_purchases_author_read_policy_fix.sql — RELEASE-03 VERIFICATION
-- (R03V: дефект найден независимой RLS-пробой на чистой PG18)
--
-- ДЕФЕКТ (латентен с 0075):
--   Политика 0012 "recipe_purchases_buyer_or_author_read" (SELECT, authenticated):
--     USING (buyer_id = auth.uid() OR recipe_id IN (
--       SELECT id FROM public.recipe_marketplace WHERE author_id = auth.uid()
--     ))
--   Подзапрос возвращает id ОФФЕРОВ (recipe_marketplace.id), тогда как с
--   миграции 0075 recipe_purchases.recipe_id = recipes.id (id КОРНЯ рецепта).
--   Сравнение всегда false → авторская ветка политики мертва: автор не видит
--   свои продажи (recipe_purchases своего рецепта) через PostgREST.
--   Клиентский виджет роялти (recipe-developer-dashboard.tsx useRecentPurchases)
--   потому всегда пуст (усугублён тем, что и сам виджет фильтровал по id
--   офферов — исправлен тем же фиксом).
--
--   Серверные пути (supabaseAdmin, service_role) не затронуты — дефект чисто
--   на клиентском PostgREST-чтении.
--
-- ФИКС (минимальный): подзапрос возвращает recipe_id офферов автора:
--     recipe_id IN (SELECT recipe_id FROM public.recipe_marketplace
--                   WHERE author_id = auth.uid())
--   Семантика по имени политики («buyer_or_author_read»): покупатель читает
--   свои покупки, автор — покупки СВОИХ рецептов. Расширения прав нет:
--   ветка была задумана в 0012 и оставалась рабочей до смены FK в 0075.
--
-- Идемпотентность: DO-гварда pg_policies по наличию СТАРОГО выражения
-- (подзапрос "SELECT id FROM recipe_marketplace"). Повторный прогон — no-op.
--
-- GRANT: не меняются. ROLLBACK: recreate с прежним (старым) выражением.
-- ============================================================================

DO $$
BEGIN
  -- Старая политика: pg_policies нормализует qual к "...( SELECT recipe_marketplace.id
  -- FROM recipe_marketplace ...)". Гвард по фактическому признаку дефекта —
  -- обращение к id ОФФЕРА (recipe_marketplace.id); после фикса qual содержит
  -- recipe_marketplace.recipe_id (подстрока ".id" не встречается — rerun-safe).
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'recipe_purchases'
       AND policyname = 'recipe_purchases_buyer_or_author_read'
       AND qual LIKE '%recipe_marketplace.id%'
  ) THEN
    DROP POLICY recipe_purchases_buyer_or_author_read ON public.recipe_purchases;
    CREATE POLICY recipe_purchases_buyer_or_author_read
      ON public.recipe_purchases FOR SELECT
      TO authenticated
      USING (buyer_id = auth.uid() OR recipe_id IN (
        SELECT recipe_id FROM public.recipe_marketplace WHERE author_id = auth.uid()
      ));
  END IF;
END $$;
