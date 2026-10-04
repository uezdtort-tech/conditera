-- 0042_profile_notify_prefs.sql
--
-- profiles.notify_prefs — колонка, на которую опирается src/lib/notifications.ts
-- (select "id, email, phone, name, notify_prefs"), но которой не было ни в одной
-- миграции. На живом Dev/Prod она существовала только как ручная правка, в
-- локальном runtime её отсутствие валило sendNotification ошибкой 42703
-- («column profiles.notify_prefs does not exist») → уведомления не отправлялись.
--
-- jsonb, DEFAULT '{}' — coercePrefs() в коде безопасно сводит пустой/кривой
-- jsonb к дефолтным предпочтениям (все каналы включены), поэтому обратная
-- совместимость полная: старые строки получают defaults, новые — реальные значения.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.notify_prefs IS
  'Настройки уведомлений (NotificationPreferences): каналы, категории, тихие часы';

-- Уведомления часто грузят профиль пользователя по id при отправке
CREATE INDEX IF NOT EXISTS idx_profiles_notify_prefs
  ON public.profiles USING gin (notify_prefs)
  WHERE notify_prefs <> '{}'::jsonb;
