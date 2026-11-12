-- ============================================================================
-- 0082_cms_versions_audit.sql — Z-v32 Пакет E-1 (CMS версионирование/
-- публикация/откат/аудит + оптимистичная блокировка site_settings)
--
-- 1) public.cms_versions — версионируемые документы CMS.
--    Для entity_type='site_settings' / entity_id='global' поле data хранит
--    ПОЛНЫЙ документ настроек в формате публичного контракта:
--      { "settings": [ { id, key, value, category, description, ... }, ... ] }
--    Жизненный цикл версии: draft → published → superseded.
--    Одновременно опубликована максимум ОДНА версия на (entity_type, entity_id)
--    — частичный UNIQUE-индекс.
--
-- 2) public.cms_audit — журнал действий над CMS-сущностями
--    ('save_draft' | 'publish' | 'rollback' | 'banner_create' |
--     'banner_update' | 'banner_delete'; details — только нечувствительные
--     метаданные: номера версий, id/заголовки баннеров, список изменённых
--     ключей. Секреты/PII сюда НЕ пишутся — по дисциплине маскирования 0079.)
--
-- Источник истины публичного GET /api/cms/settings:
--   cms_versions (status='published') → фолбэк на таблицу site_settings
--   (zero-downtime: до первой публикации ведут себя как раньше).
-- При publish маршрут синхронизирует site_settings (best-effort, same tx),
-- чтобы оба источника соглашались (легаси-ридеры не ломаются).
--
-- Доступ (RLS, defense-in-depth поверх серверного requireAnyRole):
--   • SELECT/INSERT/UPDATE — только user_roles ADMIN/SUPER_ADMIN (is_active);
--   • DELETE — политик НЕТ (fail-closed, журнал аудита не удаляется клиентом);
--   • серверные записи идут через service_role (supabaseAdmin/pg-пул),
--     который RLS обходит по назначению (паттерн 0079).
--
-- Реран-безопасность: все объекты IF NOT EXISTS / DO-гварды pg_policies
-- (дисциплина 0053/0071/0077/0079). Повторный прогон — no-op.
--
-- ROLLBACK PLAN (вручную, при необходимости):
--   DROP TABLE IF EXISTS public.cms_audit;
--   DROP TABLE IF EXISTS public.cms_versions;
--   (таблицы новые; публичный GET автоматически возвращается на site_settings
--    по фолбэку, данные заказов/платежей не затрагиваются)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. cms_versions — версии CMS-документов
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cms_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Пока версионируется только 'site_settings' (значение = имя таблицы-донора);
  -- 'cms_banners' живут в своей таблице (аудит — в cms_audit).
  entity_type text NOT NULL DEFAULT 'site_settings',
  -- 'global' для настроек сайта; в будущем — slug страницы и т.п.
  entity_id text NOT NULL DEFAULT 'global',
  version integer NOT NULL,
  -- Полный документ в формате публичного контракта (typed JSON, БЕЗ
  -- произвольного HTML/JS): { settings: [...] } для site_settings.
  data jsonb NOT NULL,
  -- draft → published → superseded (опубликованная версия сменяется новой)
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','superseded')),
  comment text,
  created_by uuid,                     -- auth.users.id (server-verified)
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cms_versions IS
  'Версии CMS-документов (Z-v32 E-1): draft/published/superseded; data = typed JSON в формате публичного контракта';

-- (entity_type, entity_id, version) уникальны
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cms_versions_entity_version_key'
  ) THEN
    ALTER TABLE public.cms_versions
      ADD CONSTRAINT cms_versions_entity_version_key
      UNIQUE (entity_type, entity_id, version);
  END IF;
END $$;

-- Максимум ОДНА опубликованная версия на сущность (оптимистичная блокировка
-- publication race на уровне БД)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_versions_one_published
  ON public.cms_versions (entity_type, entity_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_cms_versions_entity
  ON public.cms_versions (entity_type, entity_id, version DESC);

-- ---------------------------------------------------------------------------
-- 2. cms_audit — журнал действий над CMS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cms_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text,
  entity_id text,
  -- save_draft | publish | rollback | banner_create | banner_update | banner_delete
  action text NOT NULL,
  actor_id uuid,                       -- auth.users.id (server-verified)
  -- Нечувствительные метаданные: {from,to,version,keys[],id,title...}
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cms_audit IS
  'Журнал действий CMS (Z-v32 E-1): черновики/публикации/откаты/баннеры; только нечувствительные details';

CREATE INDEX IF NOT EXISTS idx_cms_audit_entity
  ON public.cms_audit (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_audit_action
  ON public.cms_audit (action, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Seed: существующие site_settings → версия 1 (published).
--    Только если в site_settings ЕСТЬ строки и cms_versions ещё пуст
--    (idempotent: INSERT ... SELECT ... WHERE NOT EXISTS).
-- ---------------------------------------------------------------------------
INSERT INTO public.cms_versions (entity_type, entity_id, version, data, status, comment)
SELECT
  'site_settings',
  'global',
  1,
  jsonb_build_object(
    'settings',
    COALESCE(
      jsonb_agg(to_jsonb(ss) ORDER BY ss."key"),
      '[]'::jsonb
    )
  ),
  'published',
  'Начальная версия: миграция 0082 (снимок site_settings на момент внедрения версионирования)'
FROM public.site_settings ss
WHERE EXISTS (SELECT 1 FROM public.site_settings)
  AND NOT EXISTS (
    SELECT 1 FROM public.cms_versions
     WHERE entity_type = 'site_settings' AND entity_id = 'global'
  );

-- ---------------------------------------------------------------------------
-- 4. RLS — admin-only (паттерн 0079: user_roles join, is_active).
--    Серверные записи — через service_role (обходит RLS по назначению);
--    клиентские роли — fail-closed (нет политик → нет доступа).
-- ---------------------------------------------------------------------------
ALTER TABLE public.cms_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_audit ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'cms_versions' AND policyname = 'cms_versions_select_admin'
  ) THEN
    CREATE POLICY cms_versions_select_admin ON public.cms_versions
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
     WHERE tablename = 'cms_versions' AND policyname = 'cms_versions_insert_admin'
  ) THEN
    CREATE POLICY cms_versions_insert_admin ON public.cms_versions
      FOR INSERT TO authenticated
      WITH CHECK (
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
     WHERE tablename = 'cms_versions' AND policyname = 'cms_versions_update_admin'
  ) THEN
    CREATE POLICY cms_versions_update_admin ON public.cms_versions
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      );
  END IF;
END $$;
-- DELETE-политики для cms_versions НЕТ (fail-closed; удаление версий —
-- только вручную администратором БД).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'cms_audit' AND policyname = 'cms_audit_select_admin'
  ) THEN
    CREATE POLICY cms_audit_select_admin ON public.cms_audit
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
-- INSERT/UPDATE/DELETE-политик для cms_audit НЕТ (fail-closed): журнал
--append-only, пишут только серверные компоненты (service_role/pg-пул).
