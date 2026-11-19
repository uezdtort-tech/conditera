#!/usr/bin/env bash
# Dev-only bootstrap for the Supabase PostgreSQL image.
# Supabase image initialization runs first; this script installs the local
# compatibility layer, creates a restricted app login, then applies migrations.
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

# Ensure the configured Conditera database exists.
DB_EXISTS="$(psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d template1 -Atc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")"
if [[ "$DB_EXISTS" != "1" ]]; then
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
fi

# Local compatibility objects are required before the first Conditera migration.
psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -f /compat/0000_supabase_compat.sql

# Restricted login used by the application; never grant it superuser.
psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_password=uyezdny_dev_pass <<'SQL'
SELECT format('CREATE ROLE uyezdny LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyezdny')
\gexec
ALTER ROLE uyezdny LOGIN PASSWORD :'app_password';
GRANT anon, authenticated, service_role TO uyezdny;
SELECT format('GRANT CONNECT ON DATABASE %I TO uyezdny', current_database())
\gexec
GRANT USAGE, CREATE ON SCHEMA public TO uyezdny;
GRANT USAGE ON SCHEMA auth, storage, extensions TO uyezdny;
SQL

PGUSER="$POSTGRES_USER" \
PGDATABASE="$POSTGRES_DB" \
POSTGRES_USER="$POSTGRES_USER" \
POSTGRES_DB="$POSTGRES_DB" \
MIGRATIONS_DIR=/migrations \
SEEDS_DIR=/seeds \
bash /scripts/01-apply-migrations.sh

# Grant the application login access to objects created by the migration owner.
psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO uyezdny;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO uyezdny;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO uyezdny;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO uyezdny;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO uyezdny;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO uyezdny;
SQL
