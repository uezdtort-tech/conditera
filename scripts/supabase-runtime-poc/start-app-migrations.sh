#!/bin/sh
set -eu

marker=/run/supabase-app-migrations.done
rm -f "$marker"

export PGHOST=127.0.0.1
export PGPORT="${POSTGRES_PORT:-5432}"
export PGUSER="${POSTGRES_USER:-supabase_admin}"
export PGPASSWORD="$POSTGRES_PASSWORD"
export PGDATABASE="${POSTGRES_DB:-supabase}"
export MIGRATIONS_DIR=/opt/conditera/migrations
export SEEDS_DIR=/opt/conditera/seeds
export SEED_MODE=none

mkdir -p /opt/supabase/services/postgres/opt/conditera/seeds

/usr/local/lib/supabase-runtime-poc/wait-for-postgres.sh \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:5000/status \
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh postgres 0:0 \
  /bin/bash /opt/conditera/apply-migrations.sh

# A restricted server-side login for direct PostgreSQL clients (e.g. ops tools).
# Supabase REST/Auth still use their own authenticator/anon/authenticated/service_role
# roles. This account is not a PostgreSQL superuser and is only exposed internally.
/usr/local/lib/supabase-runtime-poc/run-chroot.sh postgres 0:0 \
  /bin/bash -c 'psql -X -v ON_ERROR_STOP=1 --username "$PGUSER" --dbname "$PGDATABASE" --set=app_password="$APP_DATABASE_PASSWORD"' <<'SQL'
SELECT 'CREATE ROLE conditera_app LOGIN' 
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conditera_app') \gexec
ALTER ROLE conditera_app WITH LOGIN PASSWORD :'app_password' BYPASSRLS;
GRANT CONNECT ON DATABASE supabase TO conditera_app;
-- The Next.js PostgREST compatibility layer connects as conditera_app and
-- switches to anon/authenticated/service_role per verified JWT claims.
-- Match Supabase's authenticator role membership so SET LOCAL ROLE is legal.
GRANT anon, authenticated, service_role TO conditera_app;
GRANT USAGE ON SCHEMA public TO conditera_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO conditera_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO conditera_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO conditera_app;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO conditera_app;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO conditera_app;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO conditera_app;
SQL

# A dedicated read-only role lets pg_dump include protected Supabase schemas
# without exposing the runtime superuser password to the Next.js application.
# POC environments may omit it; production Compose requires the secret.
if [ -n "${BACKUP_DATABASE_PASSWORD:-}" ]; then
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh postgres 0:0 \
    /bin/bash -c 'psql -X -v ON_ERROR_STOP=1 --username "$PGUSER" --dbname "$PGDATABASE" --set=backup_password="$BACKUP_DATABASE_PASSWORD"' <<'SQL'
SELECT 'CREATE ROLE conditera_backup LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conditera_backup') \gexec
ALTER ROLE conditera_backup WITH LOGIN PASSWORD :'backup_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
GRANT CONNECT ON DATABASE supabase TO conditera_backup;
GRANT pg_read_all_data TO conditera_backup;
SQL
fi

touch "$marker"
echo "Conditera application migrations completed successfully."
