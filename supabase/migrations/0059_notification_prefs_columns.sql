-- 0059_notification_prefs_columns.sql (P1-e)
-- Приводит public.notification_preferences к контракту
-- /api/notifications/preferences (CAMEL_TO_SNAKE в route.ts) и
-- NotificationPreferences (src/lib/notifications.ts): добавляет недостающие
-- колонки категорий/тихих часов/лимита. Идемпотентно.
-- Примечание: номер 0058 занят миграцией чата (p1-b) — берём 0059.

ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS payment_updates BOOLEAN DEFAULT TRUE;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS new_review BOOLEAN DEFAULT TRUE;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS loyalty BOOLEAN DEFAULT TRUE;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS abandoned_cart BOOLEAN DEFAULT TRUE;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS quiet_hours_start INT DEFAULT 22;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS quiet_hours_end INT DEFAULT 9;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Europe/Moscow';
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS max_per_day INT DEFAULT 20;
