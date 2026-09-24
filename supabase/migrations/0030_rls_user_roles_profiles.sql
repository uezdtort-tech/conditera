-- ============================================================================
-- 0030_rls_user_roles_profiles.sql
--
-- RLS-политики чтения для auth-связанных таблиц, у которых они отсутствовали:
--   • public.user_roles — клиентский useAuth() читает роли через PostgREST
--   • public.profiles   — клиентский useAuth() читает свой профиль
--
-- Без политик RLS (enable + deny-all) браузер получал пустые массивы ролей
-- и дашборд любой роли падал в «Кабинет покупателя».
--
-- Мутации по-прежнему только через серверные API (service_role):
-- клиенту роли не выдаются — SELECT only.
-- ============================================================================

-- ============================================================================
-- user_roles: читаем свои активные роли
-- ============================================================================
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid());

-- ============================================================================
-- profiles: читаем свой профиль; персонал платформы — все профили
-- ============================================================================
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_select_staff" ON public.profiles;
CREATE POLICY "profiles_select_staff" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'SUPPORT')
        AND ur.is_active = true
    )
  );
