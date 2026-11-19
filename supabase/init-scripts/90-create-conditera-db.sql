-- Создание единственной рабочей БД Conditera в Supabase PostgreSQL 17.
-- Выполняется psql от имени supabase_admin. Идемпотентно.
\set ON_ERROR_STOP on

SELECT 'CREATE DATABASE conditera TEMPLATE template0 ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'conditera')
\gexec

\connect conditera

\getenv app_db_password CONDITERA_DB_PASSWORD

SELECT format('CREATE ROLE conditera WITH LOGIN SUPERUSER PASSWORD %L', :'app_db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conditera')
\gexec

ALTER ROLE conditera WITH LOGIN SUPERUSER PASSWORD :'app_db_password';
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
ALTER DATABASE conditera SET search_path TO public, extensions;

SELECT current_database() AS working_database;
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = 'conditera';
