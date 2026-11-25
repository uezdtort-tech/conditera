#!/usr/bin/env bash
set -euo pipefail

# Полный логический backup self-hosted Supabase PostgreSQL.
# Отдельно от backup прикладной БД из src/lib/backup.ts.
# SQL dump не включает внешние Storage-объекты и cluster-global роли.

CONTAINER="${SUPABASE_DB_CONTAINER:-conditera-supabase-db}"
DB_NAME="${SUPABASE_DB_NAME:-conditera}"
DB_USER="${SUPABASE_DB_USER:-supabase_admin}"
BACKUP_DIR="${SUPABASE_BACKUP_DIR:-/var/backups/conditera/supabase}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="supabase-$DB_NAME-$TIMESTAMP.sql.gz"
FINAL_PATH="$BACKUP_DIR/$BASENAME"
TMP_PATH="$FINAL_PATH.tmp"

fail() {
  echo "SUPABASE-BACKUP FAILED: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker CLI is required"
command -v gzip >/dev/null 2>&1 || fail "gzip is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "container not found: $CONTAINER"
[[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]] || fail "container is not running: $CONTAINER"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
rm -f "$TMP_PATH"

# Use TCP + password explicitly. Unix-socket peer auth maps the container's
# operating-system user and is not a reliable way to authenticate DB_USER.
SERVER_VERSION="$(docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; test -n "$PGPASSWORD"; exec psql -X -h 127.0.0.1 -p 5432 -U "$1" -d "$2" -Atqc "SHOW server_version"' sh "$DB_USER" "$DB_NAME" 2>/dev/null)" \
  || fail "cannot query PostgreSQL server version over TCP/password authentication"
PG_DUMP_VERSION="$(docker exec "$CONTAINER" pg_dump --version 2>/dev/null)" \
  || fail "pg_dump is unavailable in source container"
TABLE_COUNT="$(docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; test -n "$PGPASSWORD"; exec psql -X -h 127.0.0.1 -p 5432 -U "$1" -d "$2" -Atqc "$3"' sh "$DB_USER" "$DB_NAME" "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" 2>/dev/null)" \
  || fail "cannot count user tables over TCP/password authentication"

echo "Supabase source: container=$CONTAINER db=$DB_NAME user=$DB_USER"
echo "PostgreSQL server: $SERVER_VERSION"
echo "Dump client: $PG_DUMP_VERSION"
echo "User tables: $TABLE_COUNT"
echo "Writing full logical dump to $FINAL_PATH"

if ! docker exec -i "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; test -n "$PGPASSWORD"; exec pg_dump -h 127.0.0.1 -p 5432 "$@"' sh \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-owner \
  --no-privileges \
  --format=plain \
  | gzip -c > "$TMP_PATH"; then
  rm -f "$TMP_PATH"
  fail "pg_dump pipeline failed"
fi

gzip -t "$TMP_PATH" || { rm -f "$TMP_PATH"; fail "gzip integrity check failed"; }
[[ -s "$TMP_PATH" ]] || { rm -f "$TMP_PATH"; fail "dump is empty"; }
chmod 600 "$TMP_PATH"
mv "$TMP_PATH" "$FINAL_PATH"

CHECKSUM="$(sha256sum "$FINAL_PATH" | awk '{print $1}')"
MANIFEST="$FINAL_PATH.manifest.txt"
{
  echo "created_utc=$TIMESTAMP"
  echo "container=$CONTAINER"
  echo "database=$DB_NAME"
  echo "database_user=$DB_USER"
  echo "postgres_server_version=$SERVER_VERSION"
  echo "pg_dump_version=$PG_DUMP_VERSION"
  echo "user_tables=$TABLE_COUNT"
  echo "format=plain-sql-gzip"
  echo "sha256=$CHECKSUM"
  echo "storage_objects=NOT_INCLUDED"
  echo "cluster_globals=NOT_INCLUDED"
} > "$MANIFEST"
chmod 600 "$MANIFEST"

echo "SUPABASE-BACKUP: CREATED"
echo "file=$FINAL_PATH"
echo "manifest=$MANIFEST"
echo "sha256=$CHECKSUM"
