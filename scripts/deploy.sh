#!/usr/bin/env bash
# Локальный production deploy Conditera на едином Supabase Runtime / PostgreSQL 17.
# Запускать на целевом Windows-компьютере из Git Bash/WSL2 после заполнения env-файлов.
# Скрипт не переносит данные, не запускает demo seed и не удаляет volumes.

set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for file in .env.production .env.supabase-runtime; do
  if [ ! -f "$file" ]; then
    echo "ERROR: required file $file is missing."
    echo "Create it from the matching .example file and fill unique production secrets."
    exit 2
  fi
done

command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker Desktop/CLI not found."; exit 2; }
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js 20+ not found."; exit 2; }

echo "== Conditera local production deploy / PostgreSQL 17 =="
echo "1/5 Validate canonical single-runtime Compose graph..."
node scripts/compose-single-runtime.mjs config

echo "2/5 Build and start unified Supabase Runtime + application..."
node scripts/compose-single-runtime.mjs up -d --build

RUNTIME_CONTAINER="conditera-supabase-runtime"
WEB_ID="$(node scripts/compose-single-runtime.mjs ps -q web | head -n 1)"
if [ -z "$WEB_ID" ]; then
  echo "ERROR: Compose did not create the web container."
  node scripts/compose-single-runtime.mjs ps || true
  node scripts/compose-single-runtime.mjs logs --tail 200 web || true
  exit 3
fi

echo "3/5 Wait for PostgreSQL 17..."
READY=0
for attempt in $(seq 1 90); do
  if docker exec "$RUNTIME_CONTAINER" pg_isready -U supabase_admin -d supabase >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done
if [ "$READY" != "1" ]; then
  echo "ERROR: PostgreSQL runtime did not become ready."
  node scripts/compose-single-runtime.mjs logs --tail 200 supabase-runtime || true
  exit 4
fi

VERSION_NUM="$(docker exec "$RUNTIME_CONTAINER" psql -X -At -U supabase_admin -d supabase -c 'SHOW server_version_num')"
MIGRATIONS="$(docker exec "$RUNTIME_CONTAINER" psql -X -At -U supabase_admin -d supabase -c 'SELECT count(*) FROM public.schema_migrations')"
MAJOR="$((VERSION_NUM / 10000))"
if [ "$MAJOR" != "17" ]; then
  echo "ERROR: expected PostgreSQL 17; server_version_num=$VERSION_NUM"
  exit 5
fi
if [ "$MIGRATIONS" -lt 81 ]; then
  echo "ERROR: expected at least 81 application migrations; got $MIGRATIONS"
  exit 5
fi

echo "4/5 Wait for Next.js health endpoint..."
WEB_HEALTHY=0
for attempt in $(seq 1 60); do
  if docker exec "$WEB_ID" node -e 'fetch("http://127.0.0.1:3000/api/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' >/dev/null 2>&1; then
    WEB_HEALTHY=1
    break
  fi
  sleep 2
done
if [ "$WEB_HEALTHY" != "1" ]; then
  echo "ERROR: Next.js health endpoint did not become healthy."
  node scripts/compose-single-runtime.mjs logs --tail 200 web || true
  exit 6
fi

echo "5/5 Runtime status..."
node scripts/compose-single-runtime.mjs ps
echo
echo "PASS: Conditera is running on PostgreSQL 17 (server_version_num=$VERSION_NUM, app migrations=$MIGRATIONS)."
echo "The script did not migrate legacy data, run demo seeds, or delete volumes."
echo "External DNS/TLS, OAuth provider credentials, YooKassa and Telegram still require separate real-provider verification."
