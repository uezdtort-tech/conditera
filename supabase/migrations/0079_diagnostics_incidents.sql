-- ============================================================================
-- 0079_diagnostics_incidents.sql — DEPLOY-01 (централизованная регистрация
-- ошибок и единый реестр инцидентов)
--
-- 1) public.app_error_events   — сырые диагностические события ошибок
--                                 (frontend/backend/db/auth/payments/chat/
--                                 inventory/recipes/infra), маскированные
--                                 на стороне приложения ДО записи.
-- 2) public.app_incidents      — агрегированные инциденты по fingerprint
--                                 (повторяющиеся ошибки объединяются:
--                                 occurrence_count, first/last_seen).
-- 3) public.app_incident_history — журнал смены статусов инцидента
--                                 (NEW → TRIAGED → IN_PROGRESS → FIXED →
--                                 VERIFIED → CLOSED; REOPENED/IGNORED).
--
-- Приватность (DEPLOY-01 §3.2): поля stack_trace/message/metadata пишутся
-- ТОЛЬКО после маскирования в src/lib/diagnostics/masking.ts; БД-уровень
-- не доверяет клиенту — ingest-роут валидирует, ограничивает размер и
-- частоту; прямой INSERT аутентифицированным клиентом ЗАПРЕЩЁН (нет
-- INSERT-политики для authenticated; пишут только серверные компоненты
-- через service_role, который RLS обходит по назначению).
--
-- Доступ (RLS, defense-in-depth поверх серверной requireAnyRole):
--   • SELECT admin-only (user_roles ADMIN/SUPER_ADMIN, is_active);
--   • UPDATE admin-only (смена статуса инцидента через админ-API);
--   • INSERT/DELETE клиентских ролей — НЕТ (fail-closed).
--
-- Реран-безопасность: все объекты через IF NOT EXISTS / DO-гварды
-- pg_policies (дисциплина 0053/0071/0077). Повторный прогон — no-op.
--
-- ROLLBACK PLAN (вручную, при необходимости):
--   DROP TABLE IF EXISTS public.app_incident_history;
--   DROP TABLE IF EXISTS public.app_incidents;
--   DROP TABLE IF EXISTS public.app_error_events;
--   (таблицы новые, на них не ссылается существующая бизнес-логика;
--    удаление не затрагивает данные заказов/платежей/склада)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. app_error_events — сырые диагностические события
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_error_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Стабильный event_id, генерируется приложением (клиент может прислать свой
  -- id для корреляции с локальным логом; коллизии исключены UNIQUE-гватом).
  event_id text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- "development" | "staging" | "production" | локальный рантайм
  environment text NOT NULL DEFAULT 'development',
  app_version text NOT NULL DEFAULT 'unknown',
  service text NOT NULL DEFAULT 'conditera-web',
  -- component: frontend | api | database | auth | orders | payments | chat |
  -- inventory | recipes | infrastructure | diagnostics-selftest
  component text NOT NULL DEFAULT 'api',
  -- severity: debug | info | warning | error | critical
  severity text NOT NULL DEFAULT 'error'
    CHECK (severity IN ('debug','info','warning','error','critical')),
  error_code text,
  message text NOT NULL,
  correlation_id text,
  request_id text,
  route text,
  http_status integer,
  -- Маскированный (secrets/PII scrubbed) и обрезанный stack — пишется только
  -- сервером; клиентский ingest стека НЕ сохраняет.
  stack_trace text,
  -- fingerprint (sha-256) — группировка повторяющихся ошибок
  fingerprint text NOT NULL,
  -- источник события: server | client | cron | chat | n8n
  source text NOT NULL DEFAULT 'server'
    CHECK (source IN ('server','client','cron','chat','n8n')),
  actor_id uuid,                        -- auth.users.id (если идентифицирован)
  -- Технические метаданные (маскированные): userAgent, ipHash и пр.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_error_events IS
  'Диагностические события ошибок приложения (DEPLOY-01 §3; secrets masked app-side)';

CREATE INDEX IF NOT EXISTS idx_app_error_events_fingerprint
  ON public.app_error_events (fingerprint, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_error_events_occurred
  ON public.app_error_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_error_events_severity
  ON public.app_error_events (severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_error_events_component
  ON public.app_error_events (component, occurred_at DESC);

ALTER TABLE public.app_error_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'app_error_events' AND policyname = 'app_error_events_select_admin'
  ) THEN
    CREATE POLICY app_error_events_select_admin ON public.app_error_events
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      );
  END IF;
END $$;
-- NB: INSERT/UPDATE/DELETE-политик для anon/authenticated НЕТ —
-- клиентские роли не могут писать сырые события напрямую (fail-closed).
-- Серверные записи идут через service_role (supabaseAdmin/pg-пул).

-- ---------------------------------------------------------------------------
-- 2. app_incidents — реестр инцидентов (агрегация по fingerprint)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_incidents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  fingerprint text NOT NULL UNIQUE,
  title text NOT NULL,
  component text NOT NULL DEFAULT 'api',
  -- priority P0..P3 (DEPLOY-01 §4.1); автоматическая классификация —
  -- подсказка, НЕ истина (manual override через админ-API)
  priority text NOT NULL DEFAULT 'P2'
    CHECK (priority IN ('P0','P1','P2','P3')),
  -- Жизненный цикл §4: NEW → TRIAGED → IN_PROGRESS → FIXED → VERIFIED →
  -- CLOSED; доп: REOPENED (после CLOSED/VERIFIED при рецидиве), IGNORED
  -- (с обязательной причиной/автором/временем)
  status text NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','TRIAGED','IN_PROGRESS','FIXED','VERIFIED','CLOSED','REOPENED','IGNORED')),
  severity text NOT NULL DEFAULT 'error'
    CHECK (severity IN ('debug','info','warning','error','critical')),
  error_code text,
  last_route text,
  -- Агрегация повторов
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  first_version text,
  last_version text,
  -- Разрешение
  resolved_at timestamptz,
  resolved_version text,
  fix_commit text,
  ignore_reason text,
  ignore_actor_id uuid,
  notified_at timestamptz,             -- факт отправки P0/P1-уведомления (или null)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_incidents IS
  'Единый реестр инцидентов по fingerprint ошибок (DEPLOY-01 §4)';

CREATE INDEX IF NOT EXISTS idx_app_incidents_status
  ON public.app_incidents (status, priority, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_incidents_component
  ON public.app_incidents (component, last_seen_at DESC);

ALTER TABLE public.app_incidents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'app_incidents' AND policyname = 'app_incidents_select_admin'
  ) THEN
    CREATE POLICY app_incidents_select_admin ON public.app_incidents
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'app_incidents' AND policyname = 'app_incidents_update_admin'
  ) THEN
    CREATE POLICY app_incidents_update_admin ON public.app_incidents
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      );
  END IF;
END $$;
-- INSERT/DELETE для клиентских ролей НЕТ (fail-closed); upsert — сервером.

-- ---------------------------------------------------------------------------
-- 3. app_incident_history — журнал смены статусов
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_incident_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id uuid NOT NULL REFERENCES public.app_incidents(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid,                        -- админ, выполнивший переход (server-verified)
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_incident_history IS
  'История смены статусов инцидента (кто/когда/откуда/куда)';

CREATE INDEX IF NOT EXISTS idx_app_incident_history_incident
  ON public.app_incident_history (incident_id, created_at DESC);

ALTER TABLE public.app_incident_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'app_incident_history' AND policyname = 'app_incident_history_select_admin'
  ) THEN
    CREATE POLICY app_incident_history_select_admin ON public.app_incident_history
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      );
  END IF;
END $$;
