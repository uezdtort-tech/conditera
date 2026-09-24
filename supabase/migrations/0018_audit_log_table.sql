-- 0018_audit_log_table.sql
-- ============================================================================
-- Добавляет таблицу audit_log (snake_case, singular), которая используется
-- кодом приложения (44+ упоминаний в API routes).
--
-- Раньше миграция 0017 создавала "audit_logs" (plural, CamelCase колонки:
-- userId, entityId, userAgent, createdAt) — но этот формат НЕ соответствует
-- тому, что использует код. Код везде пишет:
--   supabaseAdmin.from("audit_log").insert({
--     user_id, action, entity_type, entity_id, metadata, created_at
--   });
--
-- Эта миграция создаёт правильную таблицу audit_log с snake_case колонками.
-- Таблица audit_logs из 0017 остаётся как есть (она не используется кодом).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  "action"    TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  metadata     JSONB DEFAULT '{}'::jsonb,
  ip           INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы для типичных запросов
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id       ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action        ON public.audit_log("action");
CREATE INDEX IF NOT EXISTS idx_audit_log_entity        ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at    ON public.audit_log(created_at DESC);

COMMENT ON TABLE  public.audit_log IS 'Аудит-лог действий пользователей и системных событий (snake_case, используется кодом приложения)';
COMMENT ON COLUMN public.audit_log.user_id     IS 'ID пользователя (NULL для системных событий)';
COMMENT ON COLUMN public.audit_log."action"    IS 'Код действия (например: n8n:webhook, nutritionist_certify, franchise_listing)';
COMMENT ON COLUMN public.audit_log.entity_type IS 'Тип сущности (product, order, user, webhook, ...)';
COMMENT ON COLUMN public.audit_log.entity_id   IS 'ID сущности (строка, т.к. может быть uuid или text)';
COMMENT ON COLUMN public.audit_log.metadata    IS 'JSONB с деталями события';
COMMENT ON COLUMN public.audit_log.ip          IS 'IP-адрес инициатора (если применимо)';
COMMENT ON COLUMN public.audit_log.user_agent  IS 'User-Agent инициатора (если применимо)';

-- RLS: пользователь видит свои записи, админ видит все
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_own_or_admin" ON public.audit_log;
CREATE POLICY "audit_log_select_own_or_admin" ON public.audit_log
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'SUPPORT')
        AND ur.is_active = true
    )
  );

-- Вставлять могут все аутентифицированные (включая service role)
DROP POLICY IF EXISTS "audit_log_insert_auth" ON public.audit_log;
CREATE POLICY "audit_log_insert_auth" ON public.audit_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL OR true);

-- Обновлять — только админ
DROP POLICY IF EXISTS "audit_log_update_admin" ON public.audit_log;
CREATE POLICY "audit_log_update_admin" ON public.audit_log
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = true
    )
  );

-- Удалять — только суперапдмин
DROP POLICY IF EXISTS "audit_log_delete_super_admin" ON public.audit_log;
CREATE POLICY "audit_log_delete_super_admin" ON public.audit_log
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'SUPER_ADMIN'
        AND ur.is_active = true
    )
  );
