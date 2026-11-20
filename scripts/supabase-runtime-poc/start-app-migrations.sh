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

touch "$marker"
echo "Conditera application migrations completed successfully."
