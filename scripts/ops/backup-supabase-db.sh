#!/usr/bin/env bash
set -euo pipefail

# Full logical backup of the self-hosted Supabase PostgreSQL container.
# Separate from the application PG18 backup in src/lib/backup.ts.
# Does not back up external Storage objects or cluster-global roles.

CONTAINER="${SUPABASE_DB_CONTAINER:-conditera-supabase-runtime}"
DB_NAME="${SUPABASE_DB_NAME:-supabase}"
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

SERVER_VERSION="$(docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec psql -X -h 127.0.0.1 -U "$1" -d "$2" -Atqc "SHOW server_version"' sh "$DB_USER" "$DB_NAME" 2>/dev/null)" \
  || fail "cannot query PostgreSQL server version"
PG_DUMP_VERSION="$(docker exec "$CONTAINER" pg_dump --version 2>/dev/null)" \
  || fail "pg_dump is unavailable in source container"
TABLE_COUNT="$(docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec psql -X -U "$1" -d "$2" -Atqc "$3"' sh "$DB_USER" "$DB_NAME" "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" 2>/dev/null)" \
  || fail "cannot count user tables"

# Supabase Vault exposes decrypted_secrets as a derived view. The PG17 target
# recreates this view from its installed Vault extension; dumping the view's
# DDL would collide with that extension-owned object. The source of truth,
# vault.secrets, remains included in the full dump.
VAULT_DECRYPTED_RELKIND="$(docker exec "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec psql -X -U "$1" -d "$2" -Atqc "$3"' sh "$DB_USER" "$DB_NAME" "SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vault' AND c.relname='decrypted_secrets'" 2>/dev/null)" \
  || fail "cannot inspect Supabase Vault derived relation"
DUMP_EXCLUDES=()
if [[ "$VAULT_DECRYPTED_RELKIND" == "v" || "$VAULT_DECRYPTED_RELKIND" == "m" ]]; then
  DUMP_EXCLUDES+=(--exclude-table=vault.decrypted_secrets)
  echo "Vault decrypted_secrets is a derived view; its definition is recreated by the target extension."
elif [[ -n "$VAULT_DECRYPTED_RELKIND" && "$VAULT_DECRYPTED_RELKIND" != "r" && "$VAULT_DECRYPTED_RELKIND" != "p" ]]; then
  fail "unexpected vault.decrypted_secrets relation kind: $VAULT_DECRYPTED_RELKIND"
fi

echo "Supabase source: container=$CONTAINER db=$DB_NAME user=$DB_USER"
echo "PostgreSQL server: $SERVER_VERSION"
echo "Dump client: $PG_DUMP_VERSION"
echo "User tables: $TABLE_COUNT"
echo "Writing full logical dump to $FINAL_PATH"

if ! docker exec -i "$CONTAINER" sh -c 'export PGPASSWORD="${POSTGRES_PASSWORD:-}"; exec pg_dump --host=127.0.0.1 "$@"' sh \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-owner \
  --no-privileges \
  "${DUMP_EXCLUDES[@]}" \
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
  echo "vault_decrypted_secrets_relkind=$VAULT_DECRYPTED_RELKIND"
  echo "storage_objects=NOT_INCLUDED"
  echo "cluster_globals=NOT_INCLUDED"
} > "$MANIFEST"
chmod 600 "$MANIFEST"

echo "SUPABASE-BACKUP: CREATED"
echo "file=$FINAL_PATH"
echo "manifest=$MANIFEST"
echo "sha256=$CHECKSUM"
