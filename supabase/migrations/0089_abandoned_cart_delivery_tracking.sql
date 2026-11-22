-- Track each distinct abandoned-cart snapshot and prevent duplicate reminders.
ALTER TABLE public.abandoned_cart_logs
  ADD COLUMN IF NOT EXISTS cart_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS abandoned_cart_logs_user_fingerprint_uidx
  ON public.abandoned_cart_logs (user_id, cart_fingerprint);

COMMENT ON COLUMN public.abandoned_cart_logs.cart_fingerprint IS
  'SHA-256 of the canonical cart snapshot; unique per user to make cron retries idempotent.';
