#!/usr/bin/env bash
set -euo pipefail

# Full Supabase backup bundle: database SQL, cluster-global roles, Storage files.
# PostgreSQL clients use TCP to avoid peer authentication on Unix sockets.
CONTAINER="${SUPABASE_DB_CONTAINER:-conditera-supabase-db}"
STORAGE_CONTAINER="${SUPABASE_STORAGE_CONTAINER:-conditera-supabase-storage}"
DB_NAME="${SUPABASE_DB_NAME:-supabase}"
DB_USER="${SUPABASE_DB_USER:-supabase}"
BACKUP_DIR="${SUPABASE_BACKUP_DIR:-/var/backups/conditera/supabase}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="supabase-${DB_NAME}-${TIMESTAMP}-$$"
SQL_PATH="$BACKUP_DIR/$BASENAME.sql.gz"
GLOBALS_PATH="$BACKUP_DIR/$BASENAME.globals.sql.gz"
STORAGE_PATH="$BACKUP_DIR/$BASENAME.storage.tar.gz"
MANIFEST="$BACKUP_DIR/$BASENAME.manifest.txt"
SQL_TMP="$SQL_PATH.tmp"
GLOBALS_TMP="$GLOBALS_PATH.tmp"
STORAGE_TMP="$STORAGE_PATH.tmp"
MANIFEST_TMP="$MANIFEST.tmp"

fail() {
  rm -f "$SQL_TMP" "$GLOBALS_TMP" "$STORAGE_TMP" "$MANIFEST_TMP"
  echo "SUPABASE-BACKUP FAILED: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker CLI is required"
command -v gzip >/dev/null 2>&1 || fail "gzip is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "database container not found: $CONTAINER"
docker inspect "$STORAGE_CONTAINER" >/dev/null 2>&1 || fail "storage container not found: $STORAGE_CONTAINER"
[[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]] || fail "database container is not running"
[[ "$(docker inspect -f '{{.State.Running}}' "$STORAGE_CONTAINER")" == "true" ]] || fail "storage container is not running"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
rm -f "$SQL_TMP" "$GLOBALS_TMP" "$STORAGE_TMP" "$MANIFEST_TMP"

SERVER_VERSION="$(docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec psql -X -h 127.0.0.1 -p 5432 -U "$1" -d "$2" -Atqc "SHOW server_version"' sh "$DB_USER" "$DB_NAME" 2>/dev/null)" \
  || fail "cannot query PostgreSQL server version over TCP"
PG_DUMP_VERSION="$(docker exec "$CONTAINER" pg_dump --version 2>/dev/null)" \
  || fail "pg_dump is unavailable in source container"
TABLE_COUNT="$(docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec psql -X -h 127.0.0.1 -p 5432 -U "$1" -d "$2" -Atqc "$3"' sh "$DB_USER" "$DB_NAME" "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" 2>/dev/null)" \
  || fail "cannot count user tables"

echo "Supabase source: db=$DB_NAME user=$DB_USER"
echo "PostgreSQL server: $SERVER_VERSION"
echo "Dump client: $PG_DUMP_VERSION"
echo "User tables: $TABLE_COUNT"

if ! docker exec -i "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec pg_dump "$@"' sh \
  --host=127.0.0.1 --port=5432 --username="$DB_USER" --dbname="$DB_NAME" \
  --clean --if-exists --no-owner --no-privileges --format=plain | gzip -c > "$SQL_TMP"; then
  fail "pg_dump pipeline failed"
fi
gzip -t "$SQL_TMP" || fail "SQL dump gzip integrity check failed"
[[ -s "$SQL_TMP" ]] || fail "SQL dump is empty"

if ! docker exec -i "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec pg_dumpall "$@"' sh \
  --host=127.0.0.1 --port=5432 --username="$DB_USER" --globals-only | gzip -c > "$GLOBALS_TMP"; then
  fail "pg_dumpall --globals-only pipeline failed"
fi
gzip -t "$GLOBALS_TMP" || fail "globals dump gzip integrity check failed"
[[ -s "$GLOBALS_TMP" ]] || fail "globals dump is empty"

# Archive the exact mounted Storage volume read-only; no Compose volume name assumptions.
if ! docker run --rm --volumes-from "$STORAGE_CONTAINER":ro alpine:3.20 \
  tar -czf - -C /mnt/storage . > "$STORAGE_TMP"; then
  fail "Storage volume archive failed"
fi
gzip -t "$STORAGE_TMP" || fail "Storage archive gzip integrity check failed"
[[ -s "$STORAGE_TMP" ]] || fail "Storage archive is empty"

mv "$SQL_TMP" "$SQL_PATH"
mv "$GLOBALS_TMP" "$GLOBALS_PATH"
mv "$STORAGE_TMP" "$STORAGE_PATH"
chmod 600 "$SQL_PATH" "$GLOBALS_PATH" "$STORAGE_PATH"

SQL_SHA="$(sha256sum "$SQL_PATH" | awk '{print $1}')"
GLOBALS_SHA="$(sha256sum "$GLOBALS_PATH" | awk '{print $1}')"
STORAGE_SHA="$(sha256sum "$STORAGE_PATH" | awk '{print $1}')"
{
  echo "created_utc=$TIMESTAMP"
  echo "database_container=$CONTAINER"
  echo "storage_container=$STORAGE_CONTAINER"
  echo "database=$DB_NAME"
  echo "database_user=$DB_USER"
  echo "postgres_server_version=$SERVER_VERSION"
  echo "pg_dump_version=$PG_DUMP_VERSION"
  echo "user_tables=$TABLE_COUNT"
  echo "sql_dump=$SQL_PATH"
  echo "sql_sha256=$SQL_SHA"
  echo "cluster_globals=$GLOBALS_PATH"
  echo "cluster_globals_sha256=$GLOBALS_SHA"
  echo "storage_archive=$STORAGE_PATH"
  echo "storage_sha256=$STORAGE_SHA"
  echo "storage_mount=/mnt/storage"
  echo "backup_scope=database+cluster-globals+storage-files"
} > "$MANIFEST_TMP"
chmod 600 "$MANIFEST_TMP"
mv "$MANIFEST_TMP" "$MANIFEST"

echo "SUPABASE-BACKUP: CREATED"
echo "manifest=$MANIFEST"
echo "sql_sha256=$SQL_SHA"
echo "globals_sha256=$GLOBALS_SHA"
echo "storage_sha256=$STORAGE_SHA"
