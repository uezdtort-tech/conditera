-- 0080_session_refresh_rotation.sql
-- Одноразовый refresh token на каждую серверную сессию.
ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS refresh_jti UUID;
CREATE INDEX IF NOT EXISTS user_sessions_refresh_jti_idx
  ON public.user_sessions(refresh_jti)
  WHERE revoked_at IS NULL;
COMMENT ON COLUMN public.user_sessions.refresh_jti IS
  'Current refresh JWT jti. Compare-and-swap rotation rejects replayed refresh tokens.';

NOTIFY pgrst, 'reload schema';
