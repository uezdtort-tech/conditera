#!/usr/bin/env bash
set -euo pipefail

# Полный backup единого Conditera PG17 runtime: SQL database + cluster globals + Storage objects.
# Для multi-container fallback задать SUPABASE_DB_CONTAINER=conditera-supabase-db и SUPABASE_STORAGE_VOLUME=conditera_supabase_storage_data.

CONTAINER="${SUPABASE_DB_CONTAINER:-conditera-supabase-runtime}"
DB_NAME="${SUPABASE_DB_NAME:-conditera}"
DB_USER="${SUPABASE_DB_USER:-supabase_admin}"
STORAGE_VOLUME="${SUPABASE_STORAGE_VOLUME:-conditera_supabase_runtime_storage_data}"
BACKUP_DIR="${SUPABASE_BACKUP_DIR:-/var/backups/conditera/supabase}"
ALPINE_IMAGE="${BACKUP_TOOL_IMAGE:-alpine:3.23}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_FILE="supabase-${DB_NAME}-${TIMESTAMP}.sql.gz"
GLOBALS_FILE="supabase-globals-${TIMESTAMP}.sql.gz"
STORAGE_FILE="supabase-storage-${TIMESTAMP}.tar.gz"
MANIFEST_FILE="supabase-${TIMESTAMP}.manifest.txt"
CHECKSUM_FILE="supabase-${TIMESTAMP}.sha256"
DB_TMP="$BACKUP_DIR/$DB_FILE.tmp"
GLOBALS_TMP="$BACKUP_DIR/$GLOBALS_FILE.tmp"
STORAGE_TMP="$BACKUP_DIR/$STORAGE_FILE.tmp"

fail() { echo "SUPABASE-BACKUP FAILED: $*" >&2; exit 1; }
cleanup() { rm -f "$DB_TMP" "$GLOBALS_TMP" "$STORAGE_TMP"; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker CLI is required"
command -v gzip >/dev/null 2>&1 || fail "gzip is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "container not found: $CONTAINER"
[[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]] || fail "container is not running: $CONTAINER"
docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 || fail "Storage volume not found: $STORAGE_VOLUME"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
rm -f "$DB_TMP" "$GLOBALS_TMP" "$STORAGE_TMP"

# Runtime mode has PostgreSQL binaries inside the extracted official image rootfs.
RUNTIME_CHROOT="false"
if docker exec "$CONTAINER" test -x /usr/local/lib/supabase-runtime-poc/run-chroot.sh >/dev/null 2>&1; then RUNTIME_CHROOT="true"; fi

db_exec() {
  if [[ "$RUNTIME_CHROOT" == "true" ]]; then
    docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; test -n "$PGPASSWORD"; exec /usr/local/lib/supabase-runtime-poc/run-chroot.sh postgres 0:0 "$@"' sh "$@"
  else
    docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; test -n "$PGPASSWORD"; exec "$@"' sh "$@"
  fi
}

# TCP/password auth avoids peer-auth mismatch on the Supabase image's Unix socket.
SERVER_VERSION="$(db_exec psql -X -h 127.0.0.1 -p 5432 -U "$DB_USER" -d "$DB_NAME" -Atqc 'SHOW server_version' 2>/dev/null)" || fail "cannot query PostgreSQL over TCP/password auth"
PG_DUMP_VERSION="$(db_exec pg_dump --version 2>/dev/null)" || fail "pg_dump is unavailable"
TABLE_COUNT="$(db_exec psql -X -h 127.0.0.1 -p 5432 -U "$DB_USER" -d "$DB_NAME" -Atqc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" 2>/dev/null)" || fail "cannot count user tables"

echo "Source: container=$CONTAINER database=$DB_NAME user=$DB_USER version=$SERVER_VERSION"
echo "Storage volume: $STORAGE_VOLUME"
echo "User tables: $TABLE_COUNT"

if ! db_exec pg_dump -h 127.0.0.1 -p 5432 -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges --format=plain --quote-all-identifiers | gzip -c > "$DB_TMP"; then
  fail "full database pg_dump pipeline failed"
fi
if ! db_exec pg_dumpall -h 127.0.0.1 -p 5432 -U "$DB_USER" --globals-only | gzip -c > "$GLOBALS_TMP"; then
  fail "cluster-global roles/grants backup failed"
fi
if ! docker run --rm -v "$STORAGE_VOLUME:/source:ro" "$ALPINE_IMAGE" sh -c 'tar -czf - -C /source .' > "$STORAGE_TMP"; then
  fail "Storage objects volume archive failed"
fi

for file in "$DB_TMP" "$GLOBALS_TMP" "$STORAGE_TMP"; do
  [[ -s "$file" ]] || fail "empty backup component: $file"
  gzip -t "$file" || fail "gzip integrity check failed: $file"
  chmod 600 "$file"
done
docker run --rm -i "$ALPINE_IMAGE" sh -c 'tar -tzf - >/dev/null' < "$STORAGE_TMP" || fail "Storage tar archive integrity check failed"

DB_SHA="$(sha256sum "$DB_TMP" | awk '{print $1}')"
GLOBALS_SHA="$(sha256sum "$GLOBALS_TMP" | awk '{print $1}')"
STORAGE_SHA="$(sha256sum "$STORAGE_TMP" | awk '{print $1}')"
mv "$DB_TMP" "$BACKUP_DIR/$DB_FILE"
mv "$GLOBALS_TMP" "$BACKUP_DIR/$GLOBALS_FILE"
mv "$STORAGE_TMP" "$BACKUP_DIR/$STORAGE_FILE"

cat > "$BACKUP_DIR/$MANIFEST_FILE" <<EOF
created_utc=$TIMESTAMP
container=$CONTAINER
database=$DB_NAME
database_user=$DB_USER
postgres_server_version=$SERVER_VERSION
pg_dump_version=$PG_DUMP_VERSION
user_tables=$TABLE_COUNT
database_dump=$DB_FILE
database_dump_sha256=$DB_SHA
cluster_globals=$GLOBALS_FILE
cluster_globals_sha256=$GLOBALS_SHA
storage_volume=$STORAGE_VOLUME
storage_archive=$STORAGE_FILE
storage_archive_sha256=$STORAGE_SHA
format=full-set-sql-gzip-plus-globals-plus-storage-tar-gzip
EOF
chmod 600 "$BACKUP_DIR/$MANIFEST_FILE"
sha256sum "$BACKUP_DIR/$DB_FILE" "$BACKUP_DIR/$GLOBALS_FILE" "$BACKUP_DIR/$STORAGE_FILE" "$BACKUP_DIR/$MANIFEST_FILE" > "$BACKUP_DIR/$CHECKSUM_FILE"
chmod 600 "$BACKUP_DIR/$CHECKSUM_FILE"

echo "SUPABASE-BACKUP: CREATED"
echo "database=$BACKUP_DIR/$DB_FILE sha256=$DB_SHA"
echo "globals=$BACKUP_DIR/$GLOBALS_FILE sha256=$GLOBALS_SHA"
echo "storage=$BACKUP_DIR/$STORAGE_FILE sha256=$STORAGE_SHA"
echo "manifest=$BACKUP_DIR/$MANIFEST_FILE"
echo "checksums=$BACKUP_DIR/$CHECKSUM_FILE"