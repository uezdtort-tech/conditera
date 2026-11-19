-- Подготовка прикладной роли Conditera в единственной БД Supabase PG17.
-- Supabase postgres image уже создал БД conditera и системные схемы/роли
-- при первом старте контейнера (POSTGRES_DB=conditera).
-- Скрипт идемпотентен; не создаёт и не удаляет базы/схемы/тома.

\set ON_ERROR_STOP on
\connect conditera

\getenv app_db_password CONDITERA_DB_PASSWORD

SELECT format(
  'CREATE ROLE conditera WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD %L',
  :'app_db_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conditera')
\gexec

ALTER ROLE conditera
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS
  PASSWORD :'app_db_password';

-- PostgREST-совместимый shim делает SET LOCAL ROLE anon/authenticated/service_role
-- по проверенному JWT. Членство позволяет это без SUPERUSER.
GRANT anon, authenticated, service_role TO conditera;

GRANT CONNECT ON DATABASE conditera TO conditera;
GRANT USAGE ON SCHEMA public, auth, extensions TO conditera;

-- Приложение выполняет серверные запросы к бизнес-схеме через DATABASE_URL.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO conditera;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO conditera;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO conditera;
-- PostgreSQL grants USAGE on newly created types to PUBLIC by default;
-- ALTER DEFAULT PRIVILEGES below explicitly preserves access for future types.

-- Все будущие бизнес-объекты создаёт supabase_admin через migrator.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO conditera;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO conditera;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO conditera;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT USAGE ON TYPES TO conditera;

ALTER DATABASE conditera SET search_path TO public, extensions;

SELECT current_database() AS working_database;
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
FROM pg_roles
WHERE rolname = 'conditera';
