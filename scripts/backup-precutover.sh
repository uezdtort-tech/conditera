#!/usr/bin/env bash
# Pre-cutover safety backup for the canonical single-container PG17 release.
# Logical database dumps run before stopping PostgreSQL; Storage snapshots run
# after the old containers are stopped. No container or volume is removed.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${CONDITERA_BACKUP_DIR:-$ROOT_DIR/backups/precutover}"
RELEASE_ID="${CONDITERA_RELEASE_ID:-manual}"
SAFE_RELEASE_ID="$(printf '%s' "$RELEASE_ID" | tr -c 'A-Za-z0-9._-' '_')"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MODE="${1:---database}"

case "$MODE" in
  --database|--storage) ;;
  -h|--help)
    echo "Использование: bash scripts/backup-precutover.sh --database|--storage"
    exit 0
    ;;
  *)
    echo "ОШИБКА: неизвестный режим $MODE" >&2
    exit 2
    ;;
esac

command -v docker >/dev/null 2>&1 || { echo "ОШИБКА: Docker CLI не найден." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ОШИБКА: Docker daemon не запущен." >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

to_docker_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

append_checksum() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" >> SHA256SUMS)
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$BACKUP_DIR" && shasum -a 256 "$(basename "$file")" >> SHA256SUMS)
  else
    echo "ПРЕДУПРЕЖДЕНИЕ: sha256sum/shasum не найдены; архив сохранён без checksum manifest." >&2
  fi
}

backup_database_container() {
  local container="$1"
  if ! docker inspect "$container" >/dev/null 2>&1; then
    return 0
  fi

  local state
  state="$(docker inspect -f '{{.State.Status}}' "$container")"
  if [[ "$state" != "running" ]]; then
    echo "ПРЕДУПРЕЖДЕНИЕ: $container имеет состояние $state; логический dump пропущен, исходный volume не удаляется."
    return 0
  fi

  local remote_dump="/tmp/conditera-precutover-$SAFE_RELEASE_ID-$TIMESTAMP.dump"
  local remote_globals="/tmp/conditera-precutover-$SAFE_RELEASE_ID-$TIMESTAMP-globals.sql"
  local dump_file="$BACKUP_DIR/$container-$SAFE_RELEASE_ID-$TIMESTAMP.dump"
  local globals_file="$BACKUP_DIR/$container-$SAFE_RELEASE_ID-$TIMESTAMP-globals.sql"

  echo "Создание и проверка PostgreSQL dump: $container"
  docker exec "$container" sh -lc '
    set -eu
    : "${POSTGRES_USER:?POSTGRES_USER отсутствует в контейнере}"
    : "${POSTGRES_DB:?POSTGRES_DB отсутствует в контейнере}"
    : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD отсутствует в контейнере}"
    export PGPASSWORD="$POSTGRES_PASSWORD"
    pg_isready -h 127.0.0.1 -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" >/dev/null
    pg_dump -h 127.0.0.1 -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$1"
    pg_restore -l "$1" >/dev/null
    pg_dumpall -h 127.0.0.1 -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -l "$POSTGRES_DB" --globals-only > "$2"
    test -s "$2"
  ' sh "$remote_dump" "$remote_globals"

  docker cp "$container:$remote_dump" "$(to_docker_path "$dump_file")"
  docker cp "$container:$remote_globals" "$(to_docker_path "$globals_file")"
  docker exec "$container" rm -f "$remote_dump" "$remote_globals" >/dev/null 2>&1 || true

  [[ -s "$dump_file" ]] || { echo "ОШИБКА: пустой database dump для $container." >&2; return 1; }
  [[ -s "$globals_file" ]] || { echo "ОШИБКА: пустой globals dump для $container." >&2; return 1; }
  chmod 600 "$dump_file" "$globals_file" 2>/dev/null || true
  append_checksum "$dump_file"
  append_checksum "$globals_file"
  printf 'Проверенный backup: %s (%s bytes)\n' "$dump_file" "$(wc -c < "$dump_file" | tr -d ' ')"
}

backup_storage_mount() {
  local container="$1"
  local mount_path="$2"
  local label="$3"

  if ! docker inspect "$container" >/dev/null 2>&1; then
    return 0
  fi

  local state
  state="$(docker inspect -f '{{.State.Status}}' "$container")"
  if [[ "$state" == "running" ]]; then
    echo "ОШИБКА: $container ещё работает; Storage snapshot должен выполняться после остановки." >&2
    return 1
  fi

  local mount_info
  mount_info="$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$mount_path\"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}" "$container")"
  if [[ -z "$mount_info" ]]; then
    return 0
  fi

  local temp_dir="$BACKUP_DIR/.tmp-$container-$label-$SAFE_RELEASE_ID-$TIMESTAMP"
  local archive="$BACKUP_DIR/$container-$label-$SAFE_RELEASE_ID-$TIMESTAMP.tar.gz"
  mkdir -p "$temp_dir"
  echo "Архивация Storage mount: $container:$mount_path"
  if ! docker cp "$container:$mount_path/." "$(to_docker_path "$temp_dir")"; then
    rm -rf "$temp_dir"
    echo "ОШИБКА: не удалось скопировать $container:$mount_path." >&2
    return 1
  fi
  tar -czf "$archive" -C "$temp_dir" .
  rm -rf "$temp_dir"
  [[ -s "$archive" ]] || { echo "ОШИБКА: пустой Storage archive $archive." >&2; return 1; }
  chmod 600 "$archive" 2>/dev/null || true
  append_checksum "$archive"
  printf 'Storage backup: %s (%s bytes)\n' "$archive" "$(wc -c < "$archive" | tr -d ' ')"
}

case "$MODE" in
  --database)
    found=0
    for container in conditera-db conditera-supabase-db conditera-supabase-runtime; do
      if docker inspect "$container" >/dev/null 2>&1; then
        found=1
        backup_database_container "$container"
      fi
    done
    if [[ "$found" -eq 0 ]]; then
      echo "Существующих PostgreSQL контейнеров нет; будет создан чистый PG17 volume."
    fi
    ;;
  --storage)
    found=0
    for spec in \
      "conditera-supabase-storage|/mnt/storage|legacy-supabase-storage" \
      "conditera-supabase-runtime|/opt/supabase/services/storage/var/lib/storage|pg17-storage" \
      "conditera-web|/app/storage|product-media" \
      "conditera-web|/app/supabase-storage|web-storage-backup"; do
      IFS='|' read -r container mount_path label <<< "$spec"
      if docker inspect "$container" >/dev/null 2>&1; then
        found=1
        backup_storage_mount "$container" "$mount_path" "$label"
      fi
    done
    if [[ "$found" -eq 0 ]]; then
      echo "Storage контейнеров для архивирования нет; исходные Docker volumes не удаляются."
    fi
    ;;
esac

echo "Pre-cutover backup stage completed. No database, container, or volume was removed."
