#!/usr/bin/env bash
set -Eeuo pipefail

# Verify the two artifacts produced by backup-supabase-runtime.sh:
# 1) restore the SQL database dump into a separate PostgreSQL cluster and compare
#    schema/table sets and exact row counts;
# 2) extract the Storage archive into a disposable Docker volume and compare
#    SHA-256 hashes of every file against the source Storage volume.
#
# Required for the database restore:
#   DIRECT_DATABASE_URL (or PGURL/DATABASE_URL)
#   BACKUP_RESTORE_DATABASE_URL (must point to a separate PG cluster)
# Optional:
#   BACKUP_RESTORE_PSQL_URL, BACKUP_STORAGE_VOLUME
BACKUP_DIR="${1:-${SUPABASE_BACKUP_DIR:-/var/backups/conditera/supabase}}"
BACKUP_NAME="${2:?Usage: verify-supabase-runtime-backup.sh BACKUP_DIR BACKUP_NAME}"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
MANIFEST="$BACKUP_PATH/manifest.txt"
STORAGE_CONTAINER="${SUPABASE_STORAGE_CONTAINER:-conditera-supabase-runtime}"
STORAGE_MOUNT="${SUPABASE_STORAGE_MOUNT:-/opt/supabase/services/storage/var/lib/storage}"
STORAGE_VOLUME=""
if [[ -n "${SUPABASE_STORAGE_VOLUME:-}" ]]; then
  STORAGE_VOLUME="$SUPABASE_STORAGE_VOLUME"
fi
RESTORE_VOLUME="conditera_storage_restore_verify_$$"
TMP_DIR="$(mktemp -d)"

fail() {
  echo "SUPABASE-RUNTIME-RESTORE-VERIFY FAILED: $*" >&2
  exit 1
}

cleanup() {
  docker volume rm -f "$RESTORE_VOLUME" >/dev/null 2>&1 || true
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker CLI is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
command -v diff >/dev/null 2>&1 || fail "diff is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"
[[ -f "$MANIFEST" ]] || fail "backup manifest not found: $MANIFEST"

manifest_value() {
  local key="$1"
  sed -n "s/^$key=//p" "$MANIFEST" | head -n 1
}

DB_NAME="$(manifest_value database_dump)"
STORAGE_NAME="$(manifest_value storage_archive)"
EXPECTED_DB_SHA="$(manifest_value database_dump_sha256)"
EXPECTED_STORAGE_SHA="$(manifest_value storage_archive_sha256)"
[[ "$DB_NAME" == "database.sql.gz" ]] || fail "unexpected database artifact name in manifest"
[[ "$STORAGE_NAME" == "storage-objects.tar.gz" ]] || fail "unexpected Storage artifact name in manifest"

DB_FILE="$BACKUP_PATH/$DB_NAME"
STORAGE_FILE="$BACKUP_PATH/$STORAGE_NAME"
[[ -s "$DB_FILE" ]] || fail "database dump is missing or empty"
[[ -s "$STORAGE_FILE" ]] || fail "Storage archive is missing or empty"

ACTUAL_DB_SHA="$(sha256sum "$DB_FILE" | awk '{print $1}')"
ACTUAL_STORAGE_SHA="$(sha256sum "$STORAGE_FILE" | awk '{print $1}')"
[[ "$ACTUAL_DB_SHA" == "$EXPECTED_DB_SHA" ]] || fail "database dump checksum mismatch"
[[ "$ACTUAL_STORAGE_SHA" == "$EXPECTED_STORAGE_SHA" ]] || fail "Storage archive checksum mismatch"
gzip -t "$DB_FILE" || fail "database dump gzip integrity check failed"
tar -tzf "$STORAGE_FILE" >/dev/null || fail "Storage archive cannot be listed"

echo "1/2: restore database dump into a separate PostgreSQL cluster"
: "${BACKUP_RESTORE_DATABASE_URL:?BACKUP_RESTORE_DATABASE_URL is required}"
BACKUP_VERIFY_PATH="$DB_FILE" \
BACKUP_REQUIRE_FULL_RESTORE=true \
node scripts/ops/backup-verify-restore.mjs

echo "2/2: restore Storage archive into a disposable volume"
docker inspect "$STORAGE_CONTAINER" >/dev/null 2>&1 || fail "Storage container not found: $STORAGE_CONTAINER"
if [[ -z "$STORAGE_VOLUME" ]]; then
  STORAGE_VOLUME="$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"\${STORAGE_MOUNT}\"}}{{.Name}}{{end}}{{end}}" "$STORAGE_CONTAINER")"
fi
[[ -n "$STORAGE_VOLUME" ]] || fail "cannot resolve volume mounted at /mnt/storage"
docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 || fail "source Storage volume not found: $STORAGE_VOLUME"
docker volume create "$RESTORE_VOLUME" >/dev/null
docker run --rm \
  -v "$RESTORE_VOLUME:/restore" \
  -v "$BACKUP_PATH:/backup:ro" \
  alpine:3.21 sh -ec 'tar -xzf /backup/storage-objects.tar.gz -C /restore'

docker run --rm -v "$STORAGE_VOLUME:/data:ro" alpine:3.21 \
  sh -ec 'cd /data && find . -type f -exec sha256sum {} \; | sort' > "$TMP_DIR/source.sha256"
docker run --rm -v "$RESTORE_VOLUME:/data:ro" alpine:3.21 \
  sh -ec 'cd /data && find . -type f -exec sha256sum {} \; | sort' > "$TMP_DIR/restore.sha256"
if ! diff -u "$TMP_DIR/source.sha256" "$TMP_DIR/restore.sha256"; then
  fail "restored Storage objects differ from source volume"
fi

SOURCE_FILES="$(wc -l < "$TMP_DIR/source.sha256" | tr -d ' ')"
echo "SUPABASE-RUNTIME-RESTORE-VERIFY: PASSED"
echo "database_schema_and_rows=verified"
echo "storage_objects=verified"
echo "storage_files=$SOURCE_FILES"
echo "IMPORTANT: cluster globals, database roles and ACLs are not part of this backup artifact; restore them from the separately controlled role/bootstrap configuration."
