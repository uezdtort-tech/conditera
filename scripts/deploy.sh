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

echo "0/7 Validate production secrets and external integrations before changing containers..."
node scripts/verify/production-env-preflight.mjs

echo "== Conditera local production deploy / PostgreSQL 17 =="
echo "1/7 Protect existing production data before any startup..."
for legacy_container in conditera-db conditera-supabase-db; do
  if docker inspect "$legacy_container" >/dev/null 2>&1; then
    legacy_running="$(docker inspect -f '{{.State.Running}}' "$legacy_container")"
    if [ "$legacy_running" = "true" ]; then
      echo "ERROR: legacy Conditera PostgreSQL container $legacy_container is still running. Stop the legacy Conditera DB services before switching the application to the single PG17 runtime."
      exit 12
    fi
    echo "Preserving stopped legacy container and its volume: $legacy_container"
  fi
done
echo "Legacy PostgreSQL volumes and the separate RAG Supabase data directory are preserved; the PG17 runtime uses its own named volume."
echo "2/7 Validate canonical single-runtime Compose graph..."
node scripts/compose-single-runtime.mjs config

echo "3/7 Build and start unified Supabase Runtime + application..."
node scripts/compose-single-runtime.mjs up -d --build

RUNTIME_CONTAINER="conditera-supabase-runtime"
WEB_ID="$(node scripts/compose-single-runtime.mjs ps -q web | head -n 1)"
if [ -z "$WEB_ID" ]; then
  echo "ERROR: Compose did not create the web container."
  node scripts/compose-single-runtime.mjs ps || true
  node scripts/compose-single-runtime.mjs logs --tail 200 web || true
  exit 3
fi

echo "4/7 Wait for PostgreSQL 17..."
READY=0
for attempt in $(seq 1 90); do
  if docker exec "$RUNTIME_CONTAINER" pg_isready -U supabase_admin -d conditera >/dev/null 2>&1; then
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

VERSION_NUM="$(docker exec "$RUNTIME_CONTAINER" psql -X -At -U supabase_admin -d conditera -c 'SHOW server_version_num')"
MAJOR="$((VERSION_NUM / 10000))"
if [ "$MAJOR" != "17" ]; then
  echo "ERROR: expected PostgreSQL 17; server_version_num=$VERSION_NUM"
  exit 5
fi
EXPECTED_MIGRATIONS="$(for sql_file in supabase/migrations/*.sql; do basename "$sql_file"; done | sort)"
ACTUAL_MIGRATIONS="$(docker exec "$RUNTIME_CONTAINER" psql -X -At -U supabase_admin -d conditera -c 'SELECT filename FROM public.schema_migrations ORDER BY filename')"
if [ "$EXPECTED_MIGRATIONS" != "$ACTUAL_MIGRATIONS" ]; then
  echo "ERROR: applied migration ledger does not exactly match the repository migration set."
  diff -u <(printf "%s\\n" "$EXPECTED_MIGRATIONS") <(printf "%s\\n" "$ACTUAL_MIGRATIONS") || true
  exit 5
fi
BACKUP_ROLE="$(docker exec "$RUNTIME_CONTAINER" psql -X -At -U supabase_admin -d conditera -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conditera_backup' AND rolbypassrls AND NOT rolsuper)")"
if [ "$BACKUP_ROLE" != "t" ]; then
  echo "ERROR: dedicated least-privilege conditera_backup role is missing."
  exit 5
fi
PG_DUMP_VERSION="$(docker exec "$WEB_ID" pg_dump --version)"
case "$PG_DUMP_VERSION" in
  *" 17."*) ;;
  *) echo "ERROR: production pg_dump client must be PostgreSQL 17; got: $PG_DUMP_VERSION"; exit 5 ;;
esac
BACKUP_MOUNT="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/backups"}}{{.Type}}:{{.Name}}{{end}}{{end}}' "$WEB_ID")"
case "$BACKUP_MOUNT" in
  volume:*conditera_backup_data*) ;;
  *) echo "ERROR: /app/backups is not backed by the persistent conditera_backup_data volume."; exit 5 ;;
esac

echo "5/7 Wait for Next.js readiness endpoint..."
WEB_HEALTHY=0
for attempt in $(seq 1 60); do
  if docker exec "$WEB_ID" node -e 'fetch("http://127.0.0.1:3000/api/health").then(async r => { const j = await r.json(); process.exit(r.ok && j.status === "ok" && j.database === "ok" ? 0 : 1); }).catch(() => process.exit(1))' >/dev/null 2>&1; then
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

echo "6/7 Run a real PostgreSQL backup through the production API..."
BACKUP_PATH="$(docker exec "$WEB_ID" node -e '(async()=>{const secret=process.env.CRON_SECRET;if(!secret)throw new Error("CRON_SECRET missing");const r=await fetch("http://127.0.0.1:3000/api/cron/backup",{headers:{"X-Cron-Secret":secret}});const j=await r.json();if(!r.ok||!j.success||!j.backupPath||!(j.backupSizeBytes>0))throw new Error(JSON.stringify({status:r.status,result:j}));process.stdout.write(j.backupPath)})().catch(e=>{console.error(e.message);process.exit(1)})' )"
if [ -z "$BACKUP_PATH" ]; then echo "ERROR: backup endpoint returned no archive path."; exit 7; fi
docker exec "$WEB_ID" pg_restore --list "$BACKUP_PATH" >/dev/null
echo "PASS: PostgreSQL 17 backup archive is present, non-empty and readable by pg_restore."

echo "7/7 Runtime status..."
node scripts/compose-single-runtime.mjs ps
echo
echo "PASS: Conditera is running on PostgreSQL 17 (server_version_num=$VERSION_NUM); migration ledger exactly matches repository; verified backup archive created."
echo "The script did not migrate legacy data, run demo seeds, or delete volumes."
echo "External DNS/TLS, OAuth provider credentials, YooKassa and Telegram still require separate real-provider verification."
