-- 0089_enforce_single_active_account_session.sql
-- Персональный аккаунт: одновременно действует только одна серверная сессия.
-- Новая авторизованная сессия атомарно отзывает предыдущие; JWT старых устройств
-- перестают проходить getUserFromRequest через allowlist user_sessions.


CREATE OR REPLACE FUNCTION public.enforce_single_active_user_session(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_revoked_ids UUID[];
  v_count INTEGER := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'user_id and session_id are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.user_sessions
    WHERE id = p_session_id AND user_id = p_user_id
      AND revoked_at IS NULL AND expires_at > v_now
  ) THEN
    -- Другой конкурентный login уже победил и отозвал эту сессию.
    RETURN -1;
  END IF;

  WITH revoked AS (
    UPDATE public.user_sessions
    SET revoked_at = v_now, revoked_reason = 'replaced_by_new_login'
    WHERE user_id = p_user_id
      AND id <> p_session_id
      AND revoked_at IS NULL
      AND expires_at > v_now
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]), count(*)::INTEGER
  INTO v_revoked_ids, v_count
  FROM revoked;

  IF v_count > 0 THEN
    INSERT INTO public.user_security_events (
      user_id, session_id, event_type, severity, details
    )
    SELECT p_user_id, revoked_id, 'session_revoked', 'warning',
      jsonb_build_object('reason', 'replaced_by_new_login', 'replacement_session_id', p_session_id)
    FROM unnest(v_revoked_ids) AS revoked_id;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_single_active_user_session(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_single_active_user_session(UUID, UUID)
  TO service_role;

-- DB-level guard: any server-side session insert (not only the login helper)
-- serializes by user and revokes previous devices in the same transaction.
CREATE OR REPLACE FUNCTION public.revoke_previous_user_sessions_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  IF NEW.user_id IS NULL OR NEW.id IS NULL THEN
    RAISE EXCEPTION 'user_id and session id are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

  WITH revoked AS (
    UPDATE public.user_sessions
    SET revoked_at = v_now, revoked_reason = 'replaced_by_new_login'
    WHERE user_id = NEW.user_id
      AND revoked_at IS NULL
      AND expires_at > v_now
    RETURNING id
  )
  INSERT INTO public.user_security_events (
    user_id, session_id, event_type, severity, details
  )
  SELECT NEW.user_id, id, 'session_revoked', 'warning',
    jsonb_build_object('reason', 'replaced_by_new_login', 'replacement_session_id', NEW.id)
  FROM revoked;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS user_sessions_exclusive_insert ON public.user_sessions;
CREATE TRIGGER user_sessions_exclusive_insert
  BEFORE INSERT ON public.user_sessions
  FOR EACH ROW EXECUTE FUNCTION public.revoke_previous_user_sessions_before_insert();

CREATE OR REPLACE FUNCTION public.prevent_user_session_reactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'USER_SESSION_IDENTITY_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'USER_SESSION_CANNOT_BE_REACTIVATED'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS user_sessions_identity_and_reactivation_guard ON public.user_sessions;
CREATE TRIGGER user_sessions_identity_and_reactivation_guard
  BEFORE UPDATE ON public.user_sessions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_user_session_reactivation();

COMMENT ON FUNCTION public.enforce_single_active_user_session(UUID, UUID) IS
  'Enforces one active personal account session; a new login revokes prior device sessions atomically.';

-- Миграционный backfill: оставляем на каждом аккаунте только наиболее недавно
-- использованный активный сеанс. Старые токены перестают проходить allowlist.
WITH ranked AS (
  SELECT id, user_id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY last_seen_at DESC NULLS LAST, created_at DESC, id DESC
         ) AS position
  FROM public.user_sessions
  WHERE revoked_at IS NULL AND expires_at > now()
), revoked AS (
  UPDATE public.user_sessions s
  SET revoked_at = now(), revoked_reason = 'single_session_policy_migration'
  FROM ranked r
  WHERE s.id = r.id AND r.position > 1
  RETURNING s.user_id, s.id
)
INSERT INTO public.user_security_events (user_id, session_id, event_type, severity, details)
SELECT user_id, id, 'session_revoked', 'warning',
       jsonb_build_object('reason', 'single_session_policy_migration')
FROM revoked;

NOTIFY pgrst, 'reload schema';
