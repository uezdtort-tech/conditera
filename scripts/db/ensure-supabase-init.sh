#!/bin/sh
# Ensure Supabase's image-provided schema migrations ran before Conditera SQL.
# The image's own migrate.sh may be skipped by a customized entrypoint/command;
# this guarded call is idempotent and avoids running it twice.
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"

roles_ready="$(psql -X -v ON_ERROR_STOP=1 --no-psqlrc -U supabase_admin -d "$POSTGRES_DB" -Atc "SELECT 1 FROM pg_roles WHERE rolname = 'anon'")"
if [ "$roles_ready" = "1" ]; then
  echo "Supabase base roles already exist; image initialization is complete."
  exit 0
fi

if [ ! -f /docker-entrypoint-initdb.d/migrate.sh ]; then
  echo "Supabase migrate.sh is missing from the PostgreSQL image." >&2
  exit 1
fi

echo "Running Supabase image migrations before Conditera migrations."
sh /docker-entrypoint-initdb.d/migrate.sh
