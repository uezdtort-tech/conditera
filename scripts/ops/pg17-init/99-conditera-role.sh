#!/bin/sh
# One-time bootstrap for the isolated unified PostgreSQL 17 target.
# Creates a non-superuser Conditera login that may SET ROLE to Supabase API roles.
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${CONDITERA_DB_PASSWORD:?CONDITERA_DB_PASSWORD is required}"

psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_password="$CONDITERA_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE conditera LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conditera')
\gexec

ALTER ROLE conditera LOGIN PASSWORD :'app_password';
GRANT anon, authenticated, service_role TO conditera;
GRANT CONNECT ON DATABASE supabase TO conditera;
GRANT USAGE, CREATE ON SCHEMA public TO conditera;
GRANT USAGE ON SCHEMA auth, storage, extensions TO conditera;
ALTER DEFAULT PRIVILEGES FOR ROLE conditera IN SCHEMA public GRANT ALL ON TABLES TO conditera;
ALTER DEFAULT PRIVILEGES FOR ROLE conditera IN SCHEMA public GRANT ALL ON SEQUENCES TO conditera;
ALTER DEFAULT PRIVILEGES FOR ROLE conditera IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO conditera;
SQL
