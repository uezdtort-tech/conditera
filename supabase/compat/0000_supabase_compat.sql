-- ============================================================================
-- 0000_supabase_compat.sql — Supabase-совместимый слой для vanilla PostgreSQL.
--
-- Применяется ПЕРЕД supabase/migrations/* (см. scripts/db/setup.mjs).
-- Цель: локальный/самостоятельный PostgreSQL без Docker и Supabase-стека:
--   * схемы auth / storage / extensions (на них ссылаются миграции и RLS);
--   * роли anon / authenticated / service_role (NOLOGIN; service_role BYPASSRLS);
--   * стаб auth.users (только те поля, которые использует код и seed_vitrine.sql);
--   * SQL-функции auth.uid() / auth.role() / auth.jwt() — из request.jwt.claims,
--     которые выставляет PostgREST-шим (src/app/rest/v1/...);
--   * стабы storage.buckets / storage.objects + storage.foldername();
--   * сид стандартных бакетов (включая 'media', которую использует /api/cms/media).
--
-- Идемпотентен: повторный запуск безопасен.
-- ============================================================================

-- ===== 1. Схемы =====
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

COMMENT ON SCHEMA auth IS 'Совместимость с Supabase GoTrue: стаб auth.users + JWT-функции (локальный рантайм)';
COMMENT ON SCHEMA storage IS 'Совместимость с Supabase Storage: реестр бакетов/объектов (файлы лежат в upload/storage/)';

-- ===== 2. Роли (anon / authenticated / service_role) =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- service_role обходит RLS всегда (даже если роль создалась раньше без флага)
ALTER ROLE service_role BYPASSRLS;

GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA auth, storage TO service_role;

-- ===== 3. Стаб auth.users =====
-- Состав колонок = супerset того, что использует seed_vitrine.sql (INSERT INTO
-- auth.users: instance_id, id, aud, role, email, encrypted_password,
-- email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
-- updated_at) + поля, которые читает/пишет GoTrue-совместимый код.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text,
  aud text DEFAULT 'authenticated'::text,
  role text DEFAULT 'authenticated'::text,
  email text UNIQUE,
  encrypted_password text,
  email_confirmed_at timestamptz DEFAULT now(),
  invited_at timestamptz,
  confirmation_token text,
  recovery_token text,
  email_change text,
  email_change_token_new text,
  action_token text,
  reauthentication_token text,
  phone text,
  phone_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  is_sso_user boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

-- ===== 4. JWT-функции (источник — request.jwt.claims, выставляет шим) =====
-- auth.uid(): uuid текущего пользователя или NULL (аноним/нет claims).
-- null-safe: если GUC не установлен/пуст — NULL, не ошибку.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    CASE
      WHEN coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
        THEN NULL
      WHEN (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub') IS NULL
        THEN NULL
      ELSE (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub')::uuid
    END
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    CASE
      WHEN coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
        THEN 'anon'
      ELSE coalesce(
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role',
        'anon'
      )
    END
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    CASE
      WHEN coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
        THEN '{}'::jsonb
      ELSE coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    END
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO PUBLIC;

-- ===== 5. Стаб storage =====
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text UNIQUE,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 0026 использует storage.foldername(name) в RLS-политиках
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  _parts text[];
BEGIN
  IF name IS NULL THEN
    RETURN NULL;
  END IF;
  _parts := string_to_array(trim(name, '/'), '/');
  IF array_length(_parts, 1) < 2 THEN
    RETURN '{}';
  END IF;
  RETURN _parts[1 : array_length(_parts, 1) - 1];
END
$$;

GRANT ALL ON storage.buckets, storage.objects TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets, storage.objects TO authenticated;
GRANT SELECT ON storage.buckets, storage.objects TO anon;

-- ===== 6. Сид бакетов =====
-- 6 из 0026 (RLS-политики ссылаются на эти id) + 'media' (использует
-- /api/cms/media) + 'chat' (вложения чата).
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, created_at, updated_at)
VALUES
  ('avatars',        'avatars',        true,  ARRAY['image/jpeg','image/png','image/webp','image/gif'], now(), now()),
  ('covers',         'covers',         true,  ARRAY['image/jpeg','image/png','image/webp'],             now(), now()),
  ('portfolio',      'portfolio',      true,  ARRAY['image/jpeg','image/png','image/webp'],             now(), now()),
  ('product_images', 'product_images', true,  ARRAY['image/jpeg','image/png','image/webp','image/gif'], now(), now()),
  ('documents',      'documents',      false, ARRAY['application/pdf','image/jpeg','image/png'],        now(), now()),
  ('messages',       'messages',       false, ARRAY['image/jpeg','image/png','image/webp','video/mp4'], now(), now()),
  ('media',          'media',          true,  NULL,                                                     now(), now()),
  ('chat',           'chat',           false, NULL,                                                     now(), now())
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      updated_at = now();

-- ===== Готово =====

-- ===== 8. Бланкет-гранты service_role (семантика Supabase: служебный ключ
-- имеет полный доступ ко всему в public; миграции дают точечные гранты
-- anon/authenticated, а service_role в облаке получает их из базового шаблона) =====
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
