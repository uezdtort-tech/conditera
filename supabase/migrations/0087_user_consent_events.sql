-- 0087_user_consent_events.sql
-- Append-only журнал юридически значимых согласий и их отзыва.

CREATE TABLE IF NOT EXISTS public.user_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('grant', 'withdraw')),
  consent_type TEXT NOT NULL CHECK (consent_type IN ('personal_data', 'terms', 'offer', 'marketing')),
  document_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('password_registration', 'oauth', 'account_settings', 'admin')),
  provider TEXT CHECK (provider IS NULL OR provider IN ('yandex', 'vk', 'google')),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_consent_events_user_type_idx
  ON public.user_consent_events(user_id, consent_type, created_at DESC);

ALTER TABLE public.user_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_consent_events FROM anon, authenticated;
GRANT ALL ON TABLE public.user_consent_events TO service_role;

COMMENT ON TABLE public.user_consent_events IS
  'Неизменяемый журнал предоставления и отзыва согласий пользователя.';

NOTIFY pgrst, 'reload schema';
