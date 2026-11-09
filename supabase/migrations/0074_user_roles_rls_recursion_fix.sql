-- ============================================================================
-- 0074_user_roles_rls_recursion_fix.sql — RECIPE-02 (исправление блокирующего
-- дефекта, обнаруженного live-RLS-тестированием release-gate RECIPE-02)
--
-- ДЕФЕКТ: политики user_roles_insert_admin / user_roles_select_admin /
-- user_roles_update_admin (0001:249-263) содержат подзапрос к САМОЙ таблице
-- user_roles. PostgreSQL применяет RLS-политики к внутренним сканам тоже
-- → бесконечная рекурсия → ОШИБКА 42P17 на ЛЮБОМ запросе к user_roles под
-- ролью authenticated/anon. Продукт не падал только потому, что все
-- серверные маршруты читают роли через service_role (BYPASSRLS); прямые
-- PostgREST-пути и все политики, ссылающиеся на user_roles (включая новые
-- recipe_sources/recipe_versions/recipe_production_* из 0066/0070), под
-- authenticated ломаются.
--
-- РЕШЕНИЕ (канонический Supabase-паттерн): SECURITY DEFINER-хелпер
-- is_platform_admin() — выполняется с правами владельца (RLS не применяется,
-- рекурсии нет), без параметров (инъекций нет), STABLE, SET search_path
-- (дисциплина SEC-9). Политики user_roles переписываются на хелпер.
-- Остальные политики (profiles, products, recipes-админ-ветки 0065/0066/0070),
-- ссылающиеся на user_roles, продолжают работать — внутренний скан больше
-- не рекурсивен (select_own остаётся как есть).
--
-- Идемпотентность: CREATE OR REPLACE; переписывание политик — DO-гварды с
-- распознаванием рекурсивного выражения (qual/with_check LIKE '%user_roles%').
--
-- Нумерация: 0073 ЗАРЕЗЕРВИРОВАНА за SECURITY-RECIPE-01 (сужение RLS, Q-7 —
-- решение владельца); данный фикс — 0074, от Q-7 не зависит.
-- ============================================================================

-- ============================================================================
-- 1. Хелпер: платформенный админ (ADMIN/SUPER_ADMIN, активный)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = auth.uid()
       AND ur.role IN ('ADMIN','SUPER_ADMIN')
       AND ur.is_active = true
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'RECIPE-02/0074: admin-проверка для RLS-политик; SECURITY DEFINER устраняет рекурсию 42P17 (0001:249-263)';

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon, authenticated, service_role;

-- ============================================================================
-- 2. Переписывание рекурсивных политик user_roles (DO-гварды, rerun-safe)
-- ============================================================================
DO $$
BEGIN
  -- SELECT: рекурсивную версию заменяем на хелпер
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'user_roles'
       AND policyname = 'user_roles_select_admin'
       AND qual LIKE '%user_roles%'
  ) THEN
    DROP POLICY user_roles_select_admin ON public.user_roles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'user_roles' AND policyname = 'user_roles_select_admin'
  ) THEN
    CREATE POLICY user_roles_select_admin ON public.user_roles
      FOR SELECT TO authenticated
      USING (public.is_platform_admin());
  END IF;

  -- UPDATE: рекурсивную версию заменяем на хелпер
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'user_roles'
       AND policyname = 'user_roles_update_admin'
       AND qual LIKE '%user_roles%'
  ) THEN
    DROP POLICY user_roles_update_admin ON public.user_roles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'user_roles' AND policyname = 'user_roles_update_admin'
  ) THEN
    CREATE POLICY user_roles_update_admin ON public.user_roles
      FOR UPDATE TO authenticated
      USING (public.is_platform_admin())
      WITH CHECK (public.is_platform_admin());
  END IF;

  -- INSERT: рекурсивный WITH CHECK заменяем на хелпер
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'user_roles'
       AND policyname = 'user_roles_insert_admin'
       AND with_check LIKE '%user_roles%'
  ) THEN
    DROP POLICY user_roles_insert_admin ON public.user_roles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'user_roles' AND policyname = 'user_roles_insert_admin'
  ) THEN
    CREATE POLICY user_roles_insert_admin ON public.user_roles
      FOR INSERT TO authenticated
      WITH CHECK (public.is_platform_admin());
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK PLAN (RA.17; выполняется вручную)
-- ============================================================================
-- DROP POLICY IF EXISTS user_roles_select_admin ON public.user_roles;
-- CREATE POLICY user_roles_select_admin ON public.user_roles
--   FOR SELECT USING (EXISTS (SELECT 1 FROM public.user_roles ur
--     WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active = TRUE));
-- DROP POLICY IF EXISTS user_roles_update_admin ON public.user_roles;
-- CREATE POLICY user_roles_update_admin ON public.user_roles
--   FOR UPDATE USING (EXISTS (SELECT 1 FROM public.user_roles ur
--     WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active = TRUE));
-- DROP POLICY IF EXISTS user_roles_insert_admin ON public.user_roles;
-- CREATE POLICY user_roles_insert_admin ON public.user_roles
--   FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur
--     WHERE ur.user_id = auth.uid() AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active = TRUE));
-- DROP FUNCTION IF EXISTS public.is_platform_admin();
-- ВНИМАНИЕ: откат восстанавливает дефект 42P17 (рекурсия) для
-- authenticated-запросов к user_roles.
