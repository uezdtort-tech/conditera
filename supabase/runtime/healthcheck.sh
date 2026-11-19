#!/bin/sh
set -eu

: "${POSTGRES_USER:=supabase_admin}"
: "${POSTGRES_DB:=conditera}"
: "${PGPORT:=5432}"

PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_isready \
  -h 127.0.0.1 -p "$PGPORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null

curl --fail --silent --show-error --max-time 3 \
  http://127.0.0.1:9999/health >/dev/null
