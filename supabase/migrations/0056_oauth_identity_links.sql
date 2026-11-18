-- 0056_oauth_identity_links.sql
-- Связи внешних OAuth-идентификаторов с единой учётной записью GoTrue.
-- Клиентам таблица недоступна: чтение/запись только сервером с service_role.

CREATE TABLE IF NOT EXISTS public.oauth_identity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('yandex', 'vk', 'google')),
  provider_subject TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_authenticated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oauth_identity_links_provider_subject_key UNIQUE (provider, provider_subject),
  CONSTRAINT oauth_identity_links_user_provider_key UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS oauth_identity_links_user_id_idx
  ON public.oauth_identity_links(user_id);

ALTER TABLE public.oauth_identity_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.oauth_identity_links FROM anon, authenticated;
GRANT ALL ON TABLE public.oauth_identity_links TO service_role;

COMMENT ON TABLE public.oauth_identity_links IS
  'Серверные связи Yandex ID, VK ID и Google OIDC с пользователями Supabase Auth.';
