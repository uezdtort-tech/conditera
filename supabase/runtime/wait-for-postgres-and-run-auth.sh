#!/bin/sh
set -eu

: "${POSTGRES_USER:=supabase_admin}"
: "${POSTGRES_DB:=conditera}"
: "${PGPORT:=5432}"

attempt=0
until PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_isready -h 127.0.0.1 -p "$PGPORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    echo "PostgreSQL did not become ready after 180 seconds" >&2
    exit 1
  fi
  sleep 2
done

if [ -z "${GOTRUE_DB_DATABASE_URL:-}" ]; then
  echo "GOTRUE_DB_DATABASE_URL is required" >&2
  exit 1
fi

exec /usr/local/bin/auth
