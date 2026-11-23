#!/usr/bin/env bash
# Назначает единый пароль внутренним Supabase login-ролям.
# Выполняется только при первичной инициализации PostgreSQL из docker-entrypoint-initdb.d.
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

PSQL=(psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")

for role in authenticator pgbouncer supabase_auth_admin supabase_functions_admin supabase_storage_admin; do
  exists="$("${PSQL[@]}" -Atqc "SELECT 1 FROM pg_roles WHERE rolname = '$role'")"
  if [[ "$exists" == "1" ]]; then
    "${PSQL[@]}" --set=pgpass="$POSTGRES_PASSWORD" <<SQL
ALTER ROLE "$role" WITH PASSWORD :'pgpass';
SQL
    if [[ "$role" == "supabase_storage_admin" ]]; then
      "${PSQL[@]}" --command="GRANT CREATE ON DATABASE \"$POSTGRES_DB\" TO supabase_storage_admin;"
    fi
    printf 'Установлен пароль внутренней роли %s.\n' "$role"
  fi
done
