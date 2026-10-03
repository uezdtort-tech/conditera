-- ============================================================================
-- 0001_local_fixups.sql — пост-миграционные фиксы для локального vanilla PG.
-- Применяется setup.mjs ПОСЛЕ всех миграций (идемпотентно).
--
-- Проблема: политики из 0001_init.sql на user_roles сами запрашивают
-- user_roles (EXISTS (... FROM public.user_roles ...)) → 42P17 infinite
-- recursion при anon/authenticated-доступе. В облачном Supabase это не
-- проявлялось (все серверные пути = service_role, BYPASSRLS).
--
-- Решение: SECURITY DEFINER хелпер app_is_admin() (владелец postgres,
-- RLS не применяется) + пересоздание политик поверх него.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.app_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
      AND ur.is_active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.app_is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'MODERATOR')
      AND ur.is_active = TRUE
  );
$$;

GRANT EXECUTE ON FUNCTION public.app_is_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_is_staff() TO anon, authenticated, service_role;

-- --- user_roles: убираем саморекурсию ---
DROP POLICY IF EXISTS "user_roles_select_admin" ON public.user_roles;
CREATE POLICY "user_roles_select_admin" ON public.user_roles
  FOR SELECT USING (public.app_is_admin());

DROP POLICY IF EXISTS "user_roles_insert_admin" ON public.user_roles;
CREATE POLICY "user_roles_insert_admin" ON public.user_roles
  FOR INSERT WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS "user_roles_update_admin" ON public.user_roles;
CREATE POLICY "user_roles_update_admin" ON public.user_roles
  FOR UPDATE USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

-- --- profiles: админский доступ через хелпер (устраняет скрытую рекурсию
-- через user_roles для anon-запросов к profiles и связанным таблицам) ---
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (public.app_is_admin() OR id = auth.uid());

-- service_role всё равно BYPASSRLS; явно на всякий случай
GRANT SELECT ON public.user_roles TO anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;
