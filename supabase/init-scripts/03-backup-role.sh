#!/usr/bin/env bash
# Create the dedicated read-only PostgreSQL role used by pg_dump in production.
# This runs only during the initialisation of the fresh Supabase PG17 data volume.
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${BACKUP_DATABASE_PASSWORD:?BACKUP_DATABASE_PASSWORD is required}"

if [[ ! "$BACKUP_DATABASE_PASSWORD" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo "BACKUP_DATABASE_PASSWORD must contain exactly 64 hexadecimal characters." >&2
  exit 1
fi

PSQL=(psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")

ROLE_EXISTS="$("${PSQL[@]}" -Atqc "SELECT 1 FROM pg_roles WHERE rolname = 'conditera_backup'")"
if [[ "$ROLE_EXISTS" == "1" ]]; then
  "${PSQL[@]}" --set=backup_password="$BACKUP_DATABASE_PASSWORD" <<'SQL'
ALTER ROLE conditera_backup
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT BYPASSRLS
  CONNECTION LIMIT 3 PASSWORD :'backup_password';
SQL
else
  "${PSQL[@]}" --set=backup_password="$BACKUP_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE conditera_backup
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT BYPASSRLS
  CONNECTION LIMIT 3 PASSWORD :'backup_password';
SQL
fi

# pg_read_all_data grants SELECT and schema USAGE, not data modification.
# BYPASSRLS is required so the backup contains rows hidden by application RLS.
"${PSQL[@]}" -c "GRANT CONNECT ON DATABASE \"$POSTGRES_DB\" TO conditera_backup"
"${PSQL[@]}" -c "GRANT pg_read_all_data TO conditera_backup"

ROLE_FLAGS="$("${PSQL[@]}" -Atqc "SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND rolbypassrls FROM pg_roles WHERE rolname = 'conditera_backup'")"
[[ "$ROLE_FLAGS" == "t" ]] || {
  echo "conditera_backup does not satisfy the required least-privilege role contract." >&2
  exit 1
}

printf 'Dedicated read-only backup role conditera_backup is ready.\n'
