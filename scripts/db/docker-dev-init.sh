#!/usr/bin/env bash
# Dev-only bootstrap for the Supabase PostgreSQL image.
# The image's own migrations create Supabase roles/schemas/extensions first.
# This script creates the restricted Conditera login, then applies app migrations.
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

DB_EXISTS="$(psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d template1 -Atc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")"
if [[ "$DB_EXISTS" != "1" ]]; then
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
fi

# Supabase's pg_net worker uses the conventional local postgres role.
psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d template1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres LOGIN SUPERUSER;
  END IF;
END
$$;
SQL

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
GRANT USAGE ON SCHEMA auth, storage, extensions, pgsodium TO uyezdny;
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
