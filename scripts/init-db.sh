#!/usr/bin/env bash
# scripts/init-db.sh — единая точка инициализации PostgreSQL 17.
#
# Использование:
#   ./scripts/init-db.sh                  — embedded PostgreSQL 17, порт 54330
#   ./scripts/init-db.sh supabase         — единый Supabase Runtime / PostgreSQL 17
#   ./scripts/init-db.sh pglite           — быстрый PGlite для ограниченных тестов
#   ./scripts/init-db.sh pglite-reset     — пересоздать PGlite data directory
#
# Все полноценные режимы используют PostgreSQL 17. Legacy PG15/PG18 не запускаются.

set -Eeuo pipefail

MODE="${1:-dev}"
echo "=== Инициализация БД Conditera / PostgreSQL 17 ==="
echo "Режим: $MODE"
echo

case "$MODE" in
  pglite|pglite-reset)
    if [ "$MODE" = "pglite-reset" ]; then
      echo "→ Удаление только PGlite test directory..."
      rm -rf ./db/pglite-dev
    fi
    echo "→ Запуск PGlite (тестовый режим; не production PostgreSQL)..."
    npx tsx ./scripts/init-db-local.ts --pglite
    exit $?
    ;;

  dev|embedded)
    echo "→ Инициализация embedded PostgreSQL 17 на 127.0.0.1:54330..."
    echo "→ Старый каталог .pgdata (PG18) не используется и не удаляется."
    SEED_MODE="${SEED_MODE:-none}" npm run db:setup
    echo
    echo "PASS: локальная БД инициализирована на PostgreSQL 17."
    ;;

  supabase)
    echo "→ Запуск единого Supabase Runtime / PostgreSQL 17..."
    node scripts/compose-single-runtime.mjs up -d --build

    RUNTIME_CONTAINER="conditera-supabase-runtime"
    READY=0
    for attempt in $(seq 1 90); do
      if docker exec "$RUNTIME_CONTAINER" pg_isready -U supabase_admin -d supabase >/dev/null 2>&1; then
        READY=1
        break
      fi
      sleep 2
    done
    if [ "$READY" != "1" ]; then
      echo "ERROR: PostgreSQL 17 runtime did not become ready."
      node scripts/compose-single-runtime.mjs logs --tail 200 supabase-runtime || true
      exit 1
    fi

    VERSION_NUM="$(docker exec "$RUNTIME_CONTAINER" psql -X -At -U supabase_admin -d supabase -c 'SHOW server_version_num')"
    MIGRATIONS="$(docker exec "$RUNTIME_CONTAINER" psql -X -At -U supabase_admin -d supabase -c 'SELECT count(*) FROM public.schema_migrations')"
    MAJOR="$((VERSION_NUM / 10000))"
    if [ "$MAJOR" != "17" ]; then
      echo "ERROR: expected PostgreSQL 17, got server_version_num=$VERSION_NUM"
      exit 1
    fi
    if [ "$MIGRATIONS" -lt 81 ]; then
      echo "ERROR: expected at least 81 application migrations, got $MIGRATIONS"
      exit 1
    fi
    echo "PASS: unified Supabase Runtime PostgreSQL 17; app migrations=$MIGRATIONS."
    ;;

  *)
    echo "Usage: $0 [dev|supabase|pglite|pglite-reset]"
    exit 2
    ;;
esac
