#!/usr/bin/env bash
# Dev-only bootstrap for the Supabase PostgreSQL image.
# Supabase image initialization runs first; this script then installs the
# local compatibility objects and applies Conditera migrations/seeds.
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -f /compat/0000_supabase_compat.sql

PGUSER="$POSTGRES_USER" \
PGDATABASE="$POSTGRES_DB" \
POSTGRES_USER="$POSTGRES_USER" \
POSTGRES_DB="$POSTGRES_DB" \
MIGRATIONS_DIR=/migrations \
SEEDS_DIR=/seeds \
bash /scripts/01-apply-migrations.sh
