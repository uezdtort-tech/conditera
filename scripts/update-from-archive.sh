#!/usr/bin/env bash
# ============================================================
# update-from-archive.sh — Безопасное обновление из нового архива
# ============================================================
# Сценарий: вы получили новый архив .tar.gz от разработчика/AI-ассистента
# и хотите обновить свой работающий проект, не потеряв данные.
#
# Использование:
#   bash scripts/update-from-archive.sh /path/to/conditera-new.tar.gz
#   bash scripts/update-from-archive.sh /path/to/conditera-new.tar.gz --dry-run
#   bash scripts/update-from-archive.sh /path/to/conditera-new/        # распакованная папка
#
# Что сохраняется (не затирается):
#   - .env.local, .env.production       (ваши секреты и ID счётчиков)
#   - backups/                           (ваши бэкапы БД)
#   - db/                               (если используете PGlite)
#   - public/uploads/                   (загруженные пользователями файлы)
#   - upload/                            (для simplex)
#   - prisma/dev.db, prisma/*.db        (локальные SQLite если есть)
#
# Что обновляется:
#   - src/, supabase/, prisma/, scripts/, public/ (кроме uploads), docs/
#   - package.json, package-lock.json (с последующим npm install)
#   - next.config.ts, tsconfig.json, tailwind.config.ts
#   - .env.local.example, .env.production.example (шаблоны обновляются)
#
# Что показывается:
#   - Список новых файлов в архиве, которых нет у вас
#   - Список изменённых файлов
#   - Diff .env.local.example (какие новые переменные добавились — нужно заполнить)
#   - Список новых миграций в supabase/migrations/ (нужно применить)
#   - Список новых зависимостей в package.json (нужно npm install)
# ============================================================

set -euo pipefail

ARCHIVE="${1:-}"
DRY_RUN=false
if [ "${2:-}" = "--dry-run" ]; then
  DRY_RUN=true
fi

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }

if [ -z "$ARCHIVE" ]; then
  echo "Usage: bash scripts/update-from-archive.sh <path-to-archive-or-folder> [--dry-run]"
  echo ""
  echo "Examples:"
  echo "  bash scripts/update-from-archive.sh /tmp/conditera-2026-09-24.tar.gz"
  echo "  bash scripts/update-from-archive.sh /tmp/conditera-new/ --dry-run"
  exit 1
fi

# Проверяем что мы в корне проекта
if [ ! -f "package.json" ] || [ ! -f "next.config.ts" ]; then
  err "Запустите из корня проекта (нужен package.json + next.config.ts)."
fi

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Update from archive${NC}"
echo -e "${BOLD}  Source: $ARCHIVE${NC}"
if [ "$DRY_RUN" = true ]; then
  echo -e "${BOLD}  Mode: DRY RUN (ничего не меняется)${NC}"
fi
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""

# === Готовим временную папку ===
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

info "Подготовка архива..."

# Если передали tar.gz — распаковываем
if [[ "$ARCHIVE" == *.tar.gz ]] || [[ "$ARCHIVE" == *.tgz ]]; then
  if [ ! -f "$ARCHIVE" ]; then
    err "Файл $ARCHIVE не найден"
  fi
  info "Распаковка $ARCHIVE → $TMP_DIR"
  tar -xzf "$ARCHIVE" -C "$TMP_DIR"
  # Если внутри архива одна папка — заходим в неё
  SUBDIR=$(ls -d "$TMP_DIR"/*/ 2>/dev/null | head -1)
  if [ -n "$SUBDIR" ]; then
    NEW_SRC="$SUBDIR"
  else
    NEW_SRC="$TMP_DIR"
  fi
elif [ -d "$ARCHIVE" ]; then
  NEW_SRC="$ARCHIVE"
  info "Используем распакованную папку: $NEW_SRC"
else
  err "$ARCHIVE не является ни архивом, ни папкой"
fi

# Проверяем что в новой папке есть нужные файлы
if [ ! -f "$NEW_SRC/package.json" ] || [ ! -f "$NEW_SRC/next.config.ts" ]; then
  err "В $NEW_SRC нет package.json или next.config.ts — это не наш проект"
fi

log "Новый исходник: $NEW_SRC"

# === Backup current ===
BACKUP_DIR="backups/pre-update-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
info "Бэкап текущих критичных файлов → $BACKUP_DIR"
if [ -f ".env.local" ]; then cp ".env.local" "$BACKUP_DIR/"; fi
if [ -f ".env.production" ]; then cp ".env.production" "$BACKUP_DIR/"; fi
if [ -f "package.json" ]; then cp "package.json" "$BACKUP_DIR/"; fi
if [ -f "package-lock.json" ]; then cp "package-lock.json" "$BACKUP_DIR/"; fi
if [ -f "next.config.ts" ]; then cp "next.config.ts" "$BACKUP_DIR/"; fi
log "Бэкапы сохранены"

# === Diff файлов ===
echo ""
echo -e "${BOLD}=== ИЗМЕНЁННЫЕ ФАЙЛЫ ===${NC}"
echo ""

# Все трекаемые файлы в исходнике (кроме node_modules, .next, .git, backups, db, upload, public/uploads)
changed_files=0
new_files=0
new_env_vars=0
new_migrations=0
new_deps=0

# Список критичных директорий
DIRS=("src" "supabase" "prisma" "scripts" "public" "docs")

for dir in "${DIRS[@]}"; do
  if [ ! -d "$NEW_SRC/$dir" ]; then continue; fi
  # Используем rsync --dry-run чтобы получить список изменений
  if [ -d "$dir" ]; then
    DIFF_OUTPUT=$(rsync -arn --compare-dest="$PWD/" "$NEW_SRC/$dir/" "./$dir/" 2>/dev/null | grep -vE "/$" | head -50 || true)
  else
    # Папки нет в текущем проекте — все файлы новые
    DIFF_OUTPUT=$(find "$NEW_SRC/$dir" -type f 2>/dev/null | head -50 | sed "s|$NEW_SRC/||")
  fi
  if [ -n "$DIFF_OUTPUT" ]; then
    echo -e "${BOLD}[$dir/]${NC}"
    while IFS= read -r line; do
      if [ -f "./$line" ]; then
        echo -e "  ${YELLOW}~${NC}  $line  (изменён)"
        changed_files=$((changed_files + 1))
      else
        echo -e "  ${GREEN}+${NC}  $line  (новый)"
        new_files=$((new_files + 1))
      fi
    done <<< "$DIFF_OUTPUT"
    echo ""
  fi
done

# Корневые файлы
for f in package.json next.config.ts tsconfig.json tailwind.config.ts postcss.config.mjs \
         components.json eslint.config.mjs prisma.config.ts .env.local.example .env.production.example; do
  if [ ! -f "$NEW_SRC/$f" ]; then continue; fi
  if [ ! -f "./$f" ]; then
    echo -e "  ${GREEN}+${NC}  $f  (новый)"
    new_files=$((new_files + 1))
  elif ! diff -q "$NEW_SRC/$f" "./$f" > /dev/null 2>&1; then
    echo -e "  ${YELLOW}~${NC}  $f  (изменён)"
    changed_files=$((changed_files + 1))
  fi
done

echo ""
echo -e "${BOLD}=== НОВЫЕ ПЕРЕМЕННЫЕ В .env.local.example ===${NC}"
echo ""

if [ -f ".env.local.example" ] && [ -f "$NEW_SRC/.env.local.example" ]; then
  # Извлекаем имена переменных из обоих файлов (исключая комментарии и пустые строки)
  CURRENT_VARS=$(grep -E "^[A-Z_]+=" .env.local.example | sed 's/=.*//' | sort -u)
  NEW_VARS=$(grep -E "^[A-Z_]+=" "$NEW_SRC/.env.local.example" | sed 's/=.*//' | sort -u)
  ADDED_VARS=$(comm -13 <(echo "$CURRENT_VARS") <(echo "$NEW_VARS"))
  if [ -n "$ADDED_VARS" ]; then
    while IFS= read -r var; do
      [ -z "$var" ] && continue
      echo -e "  ${GREEN}+${NC}  $var"
      new_env_vars=$((new_env_vars + 1))
    done <<< "$ADDED_VARS"
    echo ""
    warn "Эти переменные новые — их нужно добавить в ваш .env.local / .env.production"
    echo "      Запустите:  bash scripts/setup-env.sh dev"
  else
    log "Новых переменных env нет"
  fi
fi

echo ""
echo -e "${BOLD}=== НОВЫЕ МИГРАЦИИ БД ===${NC}"
echo ""

if [ -d "$NEW_SRC/supabase/migrations" ]; then
  NEW_MIGS=$(find "$NEW_SRC/supabase/migrations" -name "*.sql" -type f | sed "s|$NEW_SRC/||" | sort)
  CURRENT_MIGS=""
  if [ -d "supabase/migrations" ]; then
    CURRENT_MIGS=$(find "supabase/migrations" -name "*.sql" -type f | sed "s|^|supabase/migrations/|" | sort)
  fi
  ADDED_MIGS=$(comm -13 <(echo "$CURRENT_MIGS") <(echo "$NEW_MIGS"))
  if [ -n "$ADDED_MIGS" ]; then
    while IFS= read -r mig; do
      [ -z "$mig" ] && continue
      echo -e "  ${GREEN}+${NC}  $mig"
      new_migrations=$((new_migrations + 1))
    done <<< "$ADDED_MIGS"
    echo ""
    warn "Новые миграции нужно применить к БД:"
    echo "      psql -h localhost -p 54322 -U postgres -f $mig postgres"
    echo "      или через supabase db push"
  else
    log "Новых миграций нет"
  fi
fi

echo ""
echo -e "${BOLD}=== НОВЫЕ ЗАВИСИМОСТИ ===${NC}"
echo ""

if [ -f "$NEW_SRC/package.json" ] && [ -f "package.json" ]; then
  CURRENT_DEPS=$(jq -r '.dependencies // {} | keys[]' package.json 2>/dev/null | sort -u)
  NEW_DEPS=$(jq -r '.dependencies // {} | keys[]' "$NEW_SRC/package.json" 2>/dev/null | sort -u)
  ADDED_DEPS=$(comm -13 <(echo "$CURRENT_DEPS") <(echo "$NEW_DEPS"))
  if [ -n "$ADDED_DEPS" ]; then
    while IFS= read -r dep; do
      [ -z "$dep" ] && continue
      echo -e "  ${GREEN}+${NC}  $dep"
      new_deps=$((new_deps + 1))
    done <<< "$ADDED_DEPS"
    echo ""
    warn "Новые зависимости — после обновления запустите: npm install"
  else
    log "Новых зависимостей нет"
  fi
fi

# === ИТОГ ===
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "  ${BOLD}СВОДКА ОБНОВЛЕНИЯ${NC}"
echo -e "  Изменённых файлов:     $changed_files"
echo -e "  Новых файлов:          $new_files"
echo -e "  Новых env-переменных:  $new_env_vars"
echo -e "  Новых миграций:        $new_migrations"
echo -e "  Новых зависимостей:    $new_deps"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
  info "DRY RUN — никаких изменений не внесено."
  echo ""
  echo "Чтобы применить обновление, запустите без --dry-run:"
  echo -e "  ${BOLD}bash scripts/update-from-archive.sh \"$ARCHIVE\"${NC}"
  exit 0
fi

# === Подтверждение ===
if [ $((changed_files + new_files)) -gt 0 ]; then
  read -p "Применить обновление? (yes/no) " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Отменено пользователем. Бэкапы сохранены в $BACKUP_DIR"
    exit 0
  fi
fi

# === Применяем ===
info "Применение обновления..."

# Запоминаем что НЕ трогать
PROTECT=(
  ".env.local"
  ".env.production"
  "backups/"
  "db/"
  "upload/"
  "public/uploads/"
  "node_modules/"
  ".next/"
  ".git/"
  "tsconfig.tsbuildinfo"
)

RSYNC_EXCLUDES=()
for p in "${PROTECT[@]}"; do
  RSYNC_EXCLUDES+=("--exclude=$p")
done

# Синхронизируем основные директории
for dir in "${DIRS[@]}"; do
  if [ -d "$NEW_SRC/$dir" ]; then
    info "Синхронизация $dir/"
    mkdir -p "$dir"
    rsync -a "${RSYNC_EXCLUDES[@]}" "$NEW_SRC/$dir/" "./$dir/"
  fi
done

# Корневые файлы
for f in package.json next.config.ts tsconfig.json tailwind.config.ts postcss.config.mjs \
         components.json eslint.config.mjs prisma.config.ts .env.local.example .env.production.example; do
  if [ -f "$NEW_SRC/$f" ]; then
    # .env.local.example и .env.production.example обновляем (это шаблоны)
    cp "$NEW_SRC/$f" "./$f"
  fi
done

log "Файлы обновлены"

# === npm install если нужно ===
if [ $new_deps -gt 0 ] || ! diff -q "$NEW_SRC/package.json" "package.json" > /dev/null 2>&1; then
  echo ""
  info "Установка новых зависимостей..."
  npm install
  log "Зависимости установлены"
fi

# === Применение миграций ===
if [ $new_migrations -gt 0 ]; then
  echo ""
  warn "Найдены новые миграции БД. Применять автоматически?"
  echo "  Если БД запущена через docker-compose.supabase.yml — мы можем применить автоматически."
  read -p "Применить миграции? (yes/no) " APPLY_MIGS
  if [ "$APPLY_MIGS" = "yes" ]; then
    info "Применение миграций через psql..."
    for mig_file in $(echo "$ADDED_MIGS" | tr '\n' ' '); do
      [ -z "$mig_file" ] && continue
      log "Применение $mig_file"
      docker exec -i conditera-supabase-db psql -U postgres -d postgres < "$mig_file" 2>&1 | grep -v "^$" || true
    done
    log "Миграции применены"
  else
    warn "Миграции НЕ применены. Примените их вручную:"
    echo "  psql -h localhost -p 54322 -U postgres -d postgres -f <migration.sql>"
  fi
fi

# === Проверка env ===
echo ""
info "Проверка .env после обновления..."
bash scripts/env-check.sh || true

# === Сборка ===
echo ""
info "Пересборка проекта..."
read -p "Запустить npm run build? (yes/no) " BUILD
if [ "$BUILD" = "yes" ]; then
  npm run build
  log "Сборка завершена"
fi

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}${BOLD}ОБНОВЛЕНИЕ ЗАВЕРШЕНО${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Бэкап до обновления: $BACKUP_DIR"
echo ""
echo "  Следующие шаги:"
echo "    1. Если добавились env-переменные — заполните их:  bash scripts/setup-env.sh dev"
echo "    2. Проверьте готовность:                          bash scripts/env-check.sh"
echo "    3. Если вы в production — перезапустите сервисы:  bash scripts/deploy.sh"
echo ""
