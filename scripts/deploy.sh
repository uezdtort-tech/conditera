#!/usr/bin/env bash
# Безопасное развёртывание Conditera поверх уже подготовленной единой БД PG17.
#
# Скрипт НЕ мигрирует существующие PG15/PG18 тома и НЕ создаёт пустую БД
# вместо действующей. Перед запуском PG17 должен быть отдельно подготовлен,
# восстановлен из проверенного production backup и проверен оператором.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { printf "$GREEN[%s]$NC %s\n" "$(date +'%H:%M:%S')" "$*"; }
warn() { printf "$YELLOW[%s] WARN:$NC %s\n" "$(date +'%H:%M:%S')" "$*"; }
err()  { printf "$RED[%s] ERROR:$NC %s\n" "$(date +'%H:%M:%S')" "$*" >&2; exit 1; }

ENV_FILE=".env.production"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.supabase.yml)

check_prerequisites() {
  [[ -f package.json && -f docker-compose.yml && -f docker-compose.supabase.yml ]] || err "Запустите скрипт из корня Conditera."
  [[ -f "$ENV_FILE" ]] || err "Не найден $ENV_FILE. Production deploy остановлен."
  command -v docker >/dev/null 2>&1 || err "Docker CLI не найден."
  docker compose version >/dev/null 2>&1 || err "Docker Compose plugin недоступен."
  bash scripts/env-check.sh production || err "$ENV_FILE не прошёл production-проверку."
  "${COMPOSE[@]}" config --quiet || err "Объединённая Compose-конфигурация недействительна."
}

pull_code() {
  if [[ "${SKIP_GIT_PULL:-0}" == "1" ]]; then
    log "SKIP_GIT_PULL=1: пропускаю git pull."
    return
  fi
  log "Обновление кода из origin/main..."
  git pull --ff-only origin main || err "Не удалось выполнить git pull --ff-only. Рабочее дерево/ветку проверьте вручную."
}

assert_pg17_ready() {
  local container version major db_name
  container="$(docker ps --filter 'name=^/conditera-db$' --format '{{.ID}}' | head -n1)"
  [[ -n "$container" ]] || err "Единый контейнер conditera-db ещё не запущен. Автоматический cutover PG15/PG18 запрещён этим скриптом."
  version="$(docker exec "$container" psql -U supabase_admin -d conditera -Atqc "SHOW server_version_num" 2>/dev/null)" || err "Не удалось подключиться к conditera-db/conditera от supabase_admin."
  [[ "$version" =~ ^[0-9]+$ ]] || err "Сервер вернул некорректный номер версии PostgreSQL: '$version'."
  major=$((version / 10000))
  [[ "$major" -eq 17 ]] || err "Обнаружен PostgreSQL $major вместо 17. Скрипт не переключает major version и не переносит тома автоматически."
  db_name="$(docker exec "$container" psql -U supabase_admin -d conditera -Atqc "SELECT current_database()")"
  [[ "$db_name" == "conditera" ]] || err "Подключились не к целевой БД conditera."
  log "Подтверждён единый PostgreSQL $major, база conditera."
}

backup_data() {
  local stamp db_backup storage_backup storage_container
  stamp="$(date +%Y%m%d_%H%M%S)"
  mkdir -p backups
  db_backup="backups/predeploy-conditera-pg17-$stamp.dump"
  log "Резервное копирование БД перед миграциями: $db_backup"
  docker exec conditera-db pg_dump -U supabase_admin -d conditera --format=custom --no-owner --no-acl > "$db_backup" || err "pg_dump завершился с ошибкой."
  [[ -s "$db_backup" ]] || err "Создан пустой файл резервной копии БД."
  docker run --rm -i --entrypoint pg_restore supabase/postgres:17.6.1.136 --list < "$db_backup" > "$db_backup.list" || err "Проверка каталога резервной копии БД не прошла."
  [[ -s "$db_backup.list" ]] || err "Каталог резервной копии БД пуст."

  storage_container="$(docker ps --filter 'name=^/conditera-supabase-storage$' --format '{{.ID}}' | head -n1)"
  [[ -n "$storage_container" ]] || err "Supabase Storage не запущен; резервное копирование файлов Storage не выполнено."
  storage_backup="backups/predeploy-storage-$stamp.tar.gz"
  log "Резервное копирование файлов Supabase Storage: $storage_backup"
  docker exec "$storage_container" tar -C /mnt/storage -czf - . > "$storage_backup" || err "Архивирование файлов Storage завершилось с ошибкой."
  [[ -s "$storage_backup" ]] || err "Создан пустой архив Storage."
  tar -tzf "$storage_backup" >/dev/null || err "Проверка архива Storage не прошла."
  log "Бэкап БД и файлов Storage проверен."
}

apply_migrations() {
  log "Запуск штатного migrator через общий Compose-проект..."
  "${COMPOSE[@]}" run --rm migrator || err "Миграции остановлены с ошибкой. Web не будет обновлён."
  local applied expected
  applied="$(docker exec conditera-db psql -U supabase_admin -d conditera -Atqc "SELECT count(*) FROM public.schema_migrations")" || err "Не удалось прочитать журнал schema_migrations."
  expected="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
  [[ "$applied" == "$expected" ]] || err "В журнале $applied миграций, в репозитории $expected. Развёртывание остановлено."
  log "Журнал миграций проверен: $applied/$expected."
}

start_stack() {
  log "Запуск единого Compose-проекта Conditera + Supabase..."
  "${COMPOSE[@]}" up -d --build || err "Compose не смог запустить сервисы."
}

wait_http() {
  local name="$1" url="$2" attempts="${3:-24}"
  for attempt in $(seq 1 "$attempts"); do
    if curl --connect-timeout 3 --max-time 8 -fsS "$url" >/dev/null 2>&1; then
      log "$name отвечает: $url"
      return 0
    fi
    sleep 5
  done
  err "$name не стал отвечать: $url"
}

health_check() {
  log "Проверка web и Supabase Auth..."
  wait_http "Web" "http://127.0.0.1:3000/api/health"
  wait_http "Supabase Auth" "http://127.0.0.1:8000/auth/v1/health"
  "${COMPOSE[@]}" ps
  if ! "${COMPOSE[@]}" config --services | grep -qx 'supabase-edge-runtime'; then
    warn "В текущем Compose нет Edge Runtime. Edge Functions пока не считаются развёрнутыми; скрипт не отправляет их в удалённый Supabase проект."
  fi
}

main() {
  log "Подготовка production deployment."
  check_prerequisites
  pull_code

  # Если работает старый PG18/PG15 контейнер, preflight остановится
  # ДО backup/migrator/up и не создаст чистую БД поверх действующих данных.
  assert_pg17_ready
  backup_data
  apply_migrations
  start_stack
  health_check

  log "Deployment завершён. Старые PostgreSQL volumes не удалялись и не изменялись."
  log "Резервные копии БД и Storage находятся в backups/."
}

main "$@"
