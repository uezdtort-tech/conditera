#!/usr/bin/env bash
set -euo pipefail

# Полный backup единого Supabase Runtime: SQL, cluster globals и объекты Storage.
# В контейнере выполняется только чтение; старые volumes не удаляются и не меняются.

CONTAINER="${SUPABASE_DB_CONTAINER:-conditera-supabase-runtime}"
DB_NAME="${SUPABASE_DB_NAME:-conditera}"
DB_USER="${SUPABASE_DB_USER:-supabase_admin}"
STORAGE_VOLUME="${SUPABASE_STORAGE_VOLUME:-conditera_supabase_runtime_storage_data}"
BACKUP_DIR="${SUPABASE_BACKUP_DIR:-/var/backups/conditera/supabase}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="conditera-$DB_NAME-$TIMESTAMP"
SQL_FINAL="$BACKUP_DIR/$BASENAME.sql.gz"
GLOBALS_FINAL="$BACKUP_DIR/$BASENAME.globals.sql"
STORAGE_FINAL="$BACKUP_DIR/$BASENAME.storage.tar.gz"
MANIFEST="$BACKUP_DIR/$BASENAME.manifest.txt"
SQL_TMP="$SQL_FINAL.tmp"
GLOBALS_TMP="$GLOBALS_FINAL.tmp"
STORAGE_TMP="$STORAGE_FINAL.tmp"

fail() {
  echo "SUPABASE-BACKUP FAILED: $*" >&2
  exit 1
}
cleanup() {
  rm -f "$SQL_TMP" "$GLOBALS_TMP" "$STORAGE_TMP"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker CLI is required"
command -v gzip >/dev/null 2>&1 || fail "gzip is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "container not found: $CONTAINER"
[[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]] || fail "container is not running: $CONTAINER"
docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 || fail "Storage volume not found: $STORAGE_VOLUME"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

SERVER_VERSION="$(docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec psql -X -h 127.0.0.1 -p 5432 -U "$1" -d "$2" -Atqc "SHOW server_version"' sh "$DB_USER" "$DB_NAME" 2>/dev/null)" \
  || fail "cannot query PostgreSQL server version"
PG_DUMP_VERSION="$(docker exec "$CONTAINER" pg_dump --version 2>/dev/null)" \
  || fail "pg_dump is unavailable in source container"
TABLE_COUNT="$(docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec psql -X -h 127.0.0.1 -p 5432 -U "$1" -d "$2" -Atqc "$3"' sh "$DB_USER" "$DB_NAME" "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" 2>/dev/null)" \
  || fail "cannot count user tables"

echo "Supabase source: container=$CONTAINER db=$DB_NAME user=$DB_USER"
echo "PostgreSQL server: $SERVER_VERSION"
echo "Dump client: $PG_DUMP_VERSION"
echo "User tables: $TABLE_COUNT"
echo "Writing SQL, cluster globals and Storage archive"

if ! docker exec -i "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec pg_dump --host=127.0.0.1 --port=5432 "$@"' sh \
  --username="$DB_USER" --dbname="$DB_NAME" --no-owner --no-privileges --format=plain | gzip -c > "$SQL_TMP"; then
  fail "pg_dump pipeline failed"
fi

if ! docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec pg_dumpall --host=127.0.0.1 --port=5432 --username="$1" --dbname="$2" --globals-only' sh "$DB_USER" "$DB_NAME" > "$GLOBALS_TMP"; then
  fail "pg_dumpall --globals-only failed"
fi

if ! docker run --rm -v "$STORAGE_VOLUME:/source:ro" -v "$BACKUP_DIR:/backup" alpine:3.20 \
  sh -c 'tar -czf "/backup/$1.tmp" -C /source .' sh "$(basename "$STORAGE_FINAL")"; then
  fail "Storage volume archive failed"
fi
mv "$STORAGE_TMP" "$STORAGE_FINAL"

gzip -t "$SQL_TMP" || fail "SQL gzip integrity check failed"
gzip -t "$STORAGE_FINAL" || fail "Storage archive gzip integrity check failed"
[[ -s "$SQL_TMP" && -s "$GLOBALS_TMP" && -s "$STORAGE_FINAL" ]] || fail "one or more backup artifacts are empty"
mv "$SQL_TMP" "$SQL_FINAL"
mv "$GLOBALS_TMP" "$GLOBALS_FINAL"
chmod 600 "$SQL_FINAL" "$GLOBALS_FINAL" "$STORAGE_FINAL"

SQL_SHA="$(sha256sum "$SQL_FINAL" | awk '{print $1}')"
GLOBALS_SHA="$(sha256sum "$GLOBALS_FINAL" | awk '{print $1}')"
STORAGE_SHA="$(sha256sum "$STORAGE_FINAL" | awk '{print $1}')"
{
  echo "created_utc=$TIMESTAMP"
  echo "container=$CONTAINER"
  echo "database=$DB_NAME"
  echo "database_user=$DB_USER"
  echo "postgres_server_version=$SERVER_VERSION"
  echo "pg_dump_version=$PG_DUMP_VERSION"
  echo "user_tables=$TABLE_COUNT"
  echo "sql_dump=$(basename "$SQL_FINAL")"
  echo "sql_sha256=$SQL_SHA"
  echo "cluster_globals=$(basename "$GLOBALS_FINAL")"
  echo "cluster_globals_sha256=$GLOBALS_SHA"
  echo "storage_archive=$(basename "$STORAGE_FINAL")"
  echo "storage_sha256=$STORAGE_SHA"
} > "$MANIFEST"
chmod 600 "$MANIFEST"

trap - EXIT
echo "SUPABASE-BACKUP: CREATED"
echo "sql=$SQL_FINAL"
echo "globals=$GLOBALS_FINAL"
echo "storage=$STORAGE_FINAL"
echo "manifest=$MANIFEST"
echo "sha256.sql=$SQL_SHA"
echo "sha256.globals=$GLOBALS_SHA"
echo "sha256.storage=$STORAGE_SHA"
