-- Integrated migration 0106_abandoned_cart_delivery_tracking.sql; source branch version 0089_abandoned_cart_delivery_tracking.sql.
-- Track each distinct abandoned-cart snapshot and prevent duplicate reminders.
ALTER TABLE public.abandoned_cart_logs
  ADD COLUMN IF NOT EXISTS cart_fingerprint TEXT;

ALTER TABLE public.abandoned_cart_logs
  DROP CONSTRAINT IF EXISTS abandoned_cart_logs_reminder_channel_check;

ALTER TABLE public.abandoned_cart_logs
  ADD CONSTRAINT abandoned_cart_logs_reminder_channel_check
  CHECK (reminder_channel IS NULL OR reminder_channel IN ('email', 'push', 'telegram', 'in_app'));

CREATE UNIQUE INDEX IF NOT EXISTS abandoned_cart_logs_user_fingerprint_uidx
  ON public.abandoned_cart_logs (user_id, cart_fingerprint);

COMMENT ON COLUMN public.abandoned_cart_logs.cart_fingerprint IS
  'SHA-256 of the canonical cart snapshot; unique per user to make cron retries idempotent.';
