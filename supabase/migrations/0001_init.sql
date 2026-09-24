-- ====================================================================
-- 0001_init.sql — Начальная схема БД для «Уездный кондитер» v2.0
-- ====================================================================
-- Создаёт:
--   1. Расширения (uuid-ossp, pgcrypto, pg_cron, pg_trgm, pgsodium)
--   2. Таблицу profiles (расширение auth.users)
--   3. Таблицу user_roles (множественные роли)
--   4. Базовые enums (UserRole, LoyaltyLevel, TrustLevel)
--   5. Trigger: при INSERT в auth.users → создавать profile с CUSTOMER ролью
--   6. RLS политики: profile виден только владельцу, roles — владельцу
--
-- ВАЖНО: остальные 127 моделей будут добавлены в следующих миграциях
-- (0002_marketplace.sql, 0003_crm.sql, 0004_cms.sql, и т.д.)
-- ====================================================================

-- ===== 1. Расширения =====
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgsodium WITH SCHEMA extensions;

-- ===== 2. Enums =====

-- 27 ролей пользователей (см. prisma/schema.prisma в v1.0)
CREATE TYPE user_role AS ENUM (
  'CUSTOMER',
  'CONFECTIONER',
  'ADMIN',
  'SUPER_ADMIN',
  'COURIER',
  'SUPPLIER',
  'VENUE_OWNER',
  'ANIMATOR_AGENCY',
  'RECREATION_CENTER',
  'KIDS_CLUB',
  'GUEST',
  'MODERATOR',
  'SUPPORT',
  'STUDIO',
  'BLOGGER',
  'TASTER',
  'FRANCHISEE',
  'NUTRITIONIST',
  'CORPORATE_CLIENT',
  'QUALITY_INSPECTOR',
  'CERTIFICATION_AGENT',
  'COPYWRITER',
  'FOOD_SERVICE',
  'EVENT_ORGANIZER',
  'PICKUP_POINT',
  'WHOLESALER',
  'INSPECTOR'
);

-- Уровни лояльности
CREATE TYPE loyalty_level AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- Уровень доверия (для кондитеров)
CREATE TYPE trust_level AS ENUM ('NEW', 'VERIFIED', 'MASTER', 'EXPERT');

-- Тип аккаунта
CREATE TYPE account_type AS ENUM ('individual', 'legal');

-- Типы субъектов
CREATE TYPE tax_mode AS ENUM ('NPD', 'USN', 'OSNO', 'PSN', 'SELF_EMPLOYED');

-- Тариф
CREATE TYPE tariff AS ENUM ('START', 'BASIC', 'PREMIUM', 'BUSINESS');

-- Статусы заказа
CREATE TYPE order_status AS ENUM (
  'PENDING', 'NEGOTIATING', 'CONFIRMED', 'PREPARING',
  'READY', 'IN_DELIVERY', 'DELIVERED', 'COMPLETED',
  'CANCELLED', 'REFUNDED'
);

-- Статусы платежа
CREATE TYPE payment_status AS ENUM (
  'pending', 'waiting_for_capture', 'succeeded',
  'escrow', 'released', 'cancelled', 'refunded'
);

-- ===== 3. Таблицы =====

-- 3.1. Profiles — расширение auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  avatar_url TEXT,
  bio TEXT,
  city TEXT,
  is_blocked BOOLEAN DEFAULT FALSE,
  blocked_reason TEXT,
  blocked_at TIMESTAMPTZ,
  loyalty_level loyalty_level DEFAULT 'BRONZE',
  bonus_balance INTEGER DEFAULT 0,
  account_type account_type DEFAULT 'individual',
  -- Дополнительные поля
  default_delivery_address TEXT,
  dietary_restrictions TEXT[],
  allergens TEXT[],
  preferred_payment_method TEXT,
  birth_date DATE,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE public.profiles IS 'Расширение auth.users: имя, телефон, аватар, настройки';
COMMENT ON COLUMN public.profiles.id IS 'FK на auth.users.id';

-- 3.2. user_roles — множественные роли пользователя
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),
  deactivated_at TIMESTAMPTZ,

  UNIQUE (user_id, role)
);

COMMENT ON TABLE public.user_roles IS 'Множественные роли пользователя (role + is_active флаг)';
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_role ON public.user_roles(role) WHERE is_active = TRUE;

-- 3.3. addresses — адреса доставки (для CUSTOMER)
CREATE TABLE IF NOT EXISTS public.addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT,
  text TEXT NOT NULL,
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.addresses IS 'Адреса доставки пользователей';
CREATE INDEX idx_addresses_user_id ON public.addresses(user_id);

-- 3.4. notification_preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN DEFAULT TRUE,
  push_enabled BOOLEAN DEFAULT FALSE,
  telegram_enabled BOOLEAN DEFAULT FALSE,
  sms_enabled BOOLEAN DEFAULT FALSE,
  in_app_enabled BOOLEAN DEFAULT TRUE,
  -- Order events
  order_created BOOLEAN DEFAULT TRUE,
  order_status_changed BOOLEAN DEFAULT TRUE,
  order_delivered BOOLEAN DEFAULT TRUE,
  -- Chat events
  new_message BOOLEAN DEFAULT TRUE,
  -- Promo
  promotions BOOLEAN DEFAULT FALSE,
  -- Newsletter
  weekly_digest BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.notification_preferences IS 'Настройки уведомлений пользователя по каналам';

-- ===== 4. Triggers =====

-- 4.1. updated_at trigger для profiles
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 4.2. Auto-create profile при регистрации нового пользователя в auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Создаём профиль
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)));

  -- Создаём роль CUSTOMER (по умолчанию)
  INSERT INTO public.user_roles (user_id, role, is_active)
  VALUES (NEW.id, 'CUSTOMER', TRUE);

  -- Создаём настройки уведомлений (по умолчанию)
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ===== 5. RLS политики =====

-- 5.1. profiles — пользователь видит только свой профиль
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Админ видит все профили
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

-- 5.2. user_roles — пользователь видит только свои роли
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- Только админ может назначать роли
CREATE POLICY "user_roles_insert_admin" ON public.user_roles
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

CREATE POLICY "user_roles_update_admin" ON public.user_roles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

CREATE POLICY "user_roles_select_admin" ON public.user_roles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = TRUE)
  );

-- 5.3. addresses — пользователь видит/создаёт/удаляет только свои адреса
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "addresses_select_own" ON public.addresses
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "addresses_insert_own" ON public.addresses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "addresses_update_own" ON public.addresses
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "addresses_delete_own" ON public.addresses
  FOR DELETE USING (auth.uid() = user_id);

-- 5.4. notification_preferences — пользователь видит/редактирует только свои
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_prefs_select_own" ON public.notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "notif_prefs_update_own" ON public.notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- ===== 6. Permissions =====
-- Анонимный пользователь может регистрироваться (но не видеть данные)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profiles, public.addresses, public.notification_preferences TO authenticated;
GRANT INSERT ON public.user_roles TO authenticated; -- только через trigger

-- ===== Готово =====
-- Проверка: SELECT * FROM public.profiles LIMIT 1;
--           SELECT * FROM public.user_roles LIMIT 1;
