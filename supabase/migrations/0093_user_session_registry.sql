-- Integrated migration 0093_user_session_registry.sql; source branch version 0079_user_session_registry.sql.
-- 0093_user_session_registry.sql
-- Server-side session registry. JWTs are valid only while their sid row is active.
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('password', 'oauth', 'two_factor', 'registration', 'dev')),
  user_agent TEXT,
  ip_address TEXT,
  device_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  CONSTRAINT user_sessions_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx
  ON public.user_sessions(user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx
  ON public.user_sessions(expires_at)
  WHERE revoked_at IS NULL;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_sessions FROM anon, authenticated;
GRANT ALL ON TABLE public.user_sessions TO service_role;

CREATE TABLE IF NOT EXISTS public.user_security_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.user_sessions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  ip_address TEXT,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_security_events_user_created_idx
  ON public.user_security_events(user_id, created_at DESC);
ALTER TABLE public.user_security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_security_events FROM anon, authenticated;
GRANT ALL ON TABLE public.user_security_events TO service_role;

COMMENT ON TABLE public.user_sessions IS
  'Server-side allowlist of active Conditera sessions. Revoking a row immediately invalidates its app JWTs.';
COMMENT ON TABLE public.user_security_events IS
  'Append-only security telemetry for login, device changes, revocations and risk signals.';
NOTIFY pgrst, 'reload schema';
