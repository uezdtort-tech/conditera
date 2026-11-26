#!/usr/bin/env bash
set -Eeuo pipefail

# Atomic database + Supabase Storage file-volume backup.
# Database roles/cluster globals are intentionally NOT included; restore requires
# a bootstrapped Supabase PG cluster with the project's roles and extensions.
CONTAINER="${SUPABASE_DB_CONTAINER:-conditera-supabase-runtime}"
DB_NAME="${SUPABASE_DB_NAME:-conditera}"
DB_USER="${SUPABASE_DB_USER:-supabase_admin}"
STORAGE_CONTAINER="${SUPABASE_STORAGE_CONTAINER:-$CONTAINER}"
STORAGE_MOUNT="${SUPABASE_STORAGE_MOUNT:-/opt/supabase/services/storage/var/lib/storage}"
STORAGE_VOLUME=""
if [[ -n "${SUPABASE_STORAGE_VOLUME:-}" ]]; then
  STORAGE_VOLUME="$SUPABASE_STORAGE_VOLUME"
fi
BACKUP_DIR="${SUPABASE_BACKUP_DIR:-/var/backups/conditera/supabase}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="conditera-supabase-${TIMESTAMP}"
TMP_DIR="$BACKUP_DIR/.${BASENAME}.tmp"
FINAL_DIR="$BACKUP_DIR/$BASENAME"

fail() {
  echo "SUPABASE-RUNTIME-BACKUP FAILED: $*" >&2
  exit 1
}

cleanup() {
  if [[ -d "$TMP_DIR" ]]; then rm -rf -- "$TMP_DIR"; fi
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker CLI is required"
command -v gzip >/dev/null 2>&1 || fail "gzip is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
command -v date >/dev/null 2>&1 || fail "date is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "database container not found: $CONTAINER"
[[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]] || fail "database container is not running"
docker inspect "$STORAGE_CONTAINER" >/dev/null 2>&1 || fail "Storage container not found: $STORAGE_CONTAINER"
if [[ -z "$STORAGE_VOLUME" ]]; then
  STORAGE_VOLUME="$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"\${STORAGE_MOUNT}\"}}{{.Name}}{{end}}{{end}}" "$STORAGE_CONTAINER")"
fi
[[ -n "$STORAGE_VOLUME" ]] || fail "cannot resolve volume mounted at /mnt/storage"
docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 || fail "Storage volume not found: $STORAGE_VOLUME"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
[[ ! -e "$FINAL_DIR" ]] || fail "backup destination already exists: $FINAL_DIR"
mkdir -m 700 "$TMP_DIR"

SERVER_VERSION="$(
  docker exec "$CONTAINER" sh -c '
    export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
    exec psql -X -h 127.0.0.1 -v ON_ERROR_STOP=1 -U "$1" -d "$2" -Atqc "SHOW server_version"
  ' sh "$DB_USER" "$DB_NAME"
)" || fail "cannot query PostgreSQL over TCP/password authentication"

PG_DUMP_VERSION="$(docker exec "$CONTAINER" pg_dump --version)" || fail "pg_dump is unavailable"
TABLE_COUNT="$(
  docker exec "$CONTAINER" sh -c '
    export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
    exec psql -X -h 127.0.0.1 -v ON_ERROR_STOP=1 -U "$1" -d "$2" -Atqc       "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = current_schema()"
  ' sh "$DB_USER" "$DB_NAME"
)" || fail "cannot count user tables"

DB_FILE="$TMP_DIR/database.sql.gz"
STORAGE_FILE="$TMP_DIR/storage-objects.tar.gz"

echo "Creating PostgreSQL logical dump over TCP: $DB_NAME@$CONTAINER"
if ! docker exec "$CONTAINER" sh -c '
  export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
  exec pg_dump -h 127.0.0.1 --username="$1" --dbname="$2" --no-owner --no-privileges --format=plain
' sh "$DB_USER" "$DB_NAME" | gzip -c > "$DB_FILE"; then
  fail "database pg_dump pipeline failed"
fi
gzip -t "$DB_FILE" || fail "database dump gzip integrity check failed"
[[ -s "$DB_FILE" ]] || fail "database dump is empty"

echo "Creating Supabase Storage object archive from volume: $STORAGE_VOLUME"
docker run --rm \
  -v "$STORAGE_VOLUME:/source:ro" \
  -v "$TMP_DIR:/backup" \
  alpine:3.21 \
  sh -ec 'tar -czf /backup/storage-objects.tar.gz -C /source .'
[[ -s "$STORAGE_FILE" ]] || fail "Storage archive is empty"
docker run --rm -v "$TMP_DIR:/backup:ro" alpine:3.21 sh -ec 'tar -tzf /backup/storage-objects.tar.gz >/dev/null' \
  || fail "Storage archive integrity check failed"

DB_SHA="$(sha256sum "$DB_FILE" | awk '{print $1}')"
STORAGE_SHA="$(sha256sum "$STORAGE_FILE" | awk '{print $1}')"
DB_SIZE="$(wc -c < "$DB_FILE" | tr -d ' ')"
STORAGE_SIZE="$(wc -c < "$STORAGE_FILE" | tr -d ' ')"

cat > "$TMP_DIR/manifest.txt" <<EOF
created_utc=$TIMESTAMP
database_container=$CONTAINER
database=$DB_NAME
database_user=$DB_USER
postgres_server_version=$SERVER_VERSION
pg_dump_version=$PG_DUMP_VERSION
user_tables=$TABLE_COUNT
database_dump=database.sql.gz
database_dump_bytes=$DB_SIZE
database_dump_sha256=$DB_SHA
storage_volume=$STORAGE_VOLUME
storage_archive=storage-objects.tar.gz
storage_archive_bytes=$STORAGE_SIZE
storage_archive_sha256=$STORAGE_SHA
format=postgresql-plain-sql-gzip+supabase-storage-tar-gzip
cluster_globals=NOT_INCLUDED
database_roles=NOT_INCLUDED
database_acl=NOT_INCLUDED
EOF
chmod 600 "$DB_FILE" "$STORAGE_FILE" "$TMP_DIR/manifest.txt"
mv "$TMP_DIR" "$FINAL_DIR"
trap - EXIT

echo "SUPABASE-RUNTIME-BACKUP: CREATED"
echo "directory=$FINAL_DIR"
echo "database_sha256=$DB_SHA"
echo "storage_sha256=$STORAGE_SHA"
echo "WARNING: roles, cluster globals and ACLs are not included; restore requires role/privilege bootstrap."
