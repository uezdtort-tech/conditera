#!/usr/bin/env bash
# ============================================================
# env-check.sh — Проверка готовности .env к запуску
# ============================================================
# Использование:
#   bash scripts/env-check.sh           # проверка .env.local (dev)
#   bash scripts/env-check.sh production # проверка .env.production
#   bash scripts/env-check.sh prod       # alias
#   bash scripts/env-check.sh production mail  # + advisory-проверка mailu.env (профиль mail/full)
#
# Что проверяет:
#   1. Существование файла .env.local / .env.production
#   2. Все REQUIRED-переменные заполнены (не пустые, не начинаются с stub_)
#   3. Формат: warnings для опциональных, errors для обязательных
#   4. Специфичные проверки: формат DATABASE_URL, длина JWT_SECRET и т.д.
# ============================================================

set -euo pipefail

MODE="${1:-dev}"
if [ "$MODE" = "prod" ] || [ "$MODE" = "production" ]; then
  ENV_FILE=".env.production"
  MODE_LABEL="production"
else
  ENV_FILE=".env.local"
  MODE_LABEL="development"
fi

# DEV-16: опциональный второй аргумент — профиль compose (mail | full).
# Проверка mailu.env выполняется ТОЛЬКО при явном запросе mail-профиля и только
# как advisory (warning, не error) — дефолтный профиль от файла не зависит.
PROFILE="${2:-}"

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Счётчики
ERRORS=0
WARNINGS=0

log()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; WARNINGS=$((WARNINGS + 1)); }
err()  { echo -e "  ${RED}✗${NC} $1"; ERRORS=$((ERRORS + 1)); }
info() { echo -e "  ${BLUE}ℹ${NC} $1"; }

# Парсинг .env файла
declare -A ENV_VALUES
parse_env() {
  if [ ! -f "$1" ]; then
    return 1
  fi
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    value=$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    ENV_VALUES["$key"]="$value"
  done < "$1"
}

# Получить значение env-переменной из распарсенного файла
get_env() {
  echo "${ENV_VALUES[$1]:-}"
}

# Проверка что значение не пустое и не stub
is_filled() {
  local val="$1"
  if [ -z "$val" ] || [ "$val" = "" ]; then
    return 1
  fi
  local normalized="${val,,}"
  if [[ "$normalized" =~ ^(change_me|stub[-_]|fallback-|dev[-_]|placeholder|example|dummy|test[-_]) ]]; then
    return 1
  fi
  if [[ "$val" == *'\${'* ]]; then
    return 1
  fi
  return 0
}

# Проверка обязательной переменной
check_required() {
  local var_name="$1"
  local description="$2"
  local val
  val=$(get_env "$var_name")
  if is_filled "$val"; then
    log "$var_name  ($description)"
  else
    err "$var_name  — НЕ заполнено  ($description)"
  fi
}

# Проверка опциональной переменной (warning, не error)
check_optional() {
  local var_name="$1"
  local description="$2"
  local val
  val=$(get_env "$var_name")
  if is_filled "$val"; then
    log "$var_name  ($description)"
  else
    warn "$var_name  — пусто (опционально, $description)"
  fi
}

check_secret_value() {
  local name="$1"
  local value="$2"
  local minimum="${3:-32}"
  local normalized="${value,,}"
  if [ -z "$value" ] || [[ "$value" == *'\${'* ]] || [[ "$normalized" =~ ^(change_me|stub[-_]|fallback-|dev[-_]|placeholder|example|dummy|test[-_]) ]]; then
    err "$name отсутствует или содержит заглушку (значение скрыто)"
  elif [ "${#value}" -lt "$minimum" ]; then
    err "$name короче $minimum символов (значение скрыто)"
  fi
}

validate_database_url() {
  local name="$1"
  local value="$2"
  local expected_user="$3"
  local expected_password_ref="$4"
  if [[ ! "$value" =~ ^postgres(ql)?://([^:/@]+):([^@]+)@[^/]+/([^?]+)(\?.*)?$ ]]; then
    err "$name должен иметь формат postgresql://user:password@host/conditera"
    return
  fi
  local user="${BASH_REMATCH[2]}"
  local password="${BASH_REMATCH[3]}"
  local database="${BASH_REMATCH[4]}"
  if [ "$user" != "$expected_user" ]; then
    err "$name должен использовать роль $expected_user (фактически: $user)"
  fi
  if [ "$database" != "conditera" ]; then
    err "$name должен подключаться к базе conditera"
  fi
  if [ "$password" != "$expected_password_ref" ]; then
    check_secret_value "$name password" "$password" 32
  fi
}

# ====== START ======
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Environment check: $MODE_LABEL${NC}"
echo -e "${BOLD}  File: $ENV_FILE${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""

if [ ! -f "$ENV_FILE" ]; then
  err "Файл $ENV_FILE не найден!"
  echo ""
  echo -e "  Создайте его:"
  echo -e "    ${BOLD}bash scripts/setup-env.sh $MODE${NC}"
  echo ""
  exit 1
fi

parse_env "$ENV_FILE"
info "Файл $ENV_FILE содержит ${#ENV_VALUES[@]} переменных"
echo ""

# ===== Database & Supabase =====
echo -e "${BOLD}[DATABASE] ${NC}"
check_required "DATABASE_URL" "runtime connection URL (conditera_app)"
check_required "DIRECT_DATABASE_URL" "direct PostgreSQL URL (conditera_app)"
check_required "BACKUP_DATABASE_URL" "dedicated read-only backup role URL"
check_required "APP_DATABASE_PASSWORD" "отдельный пароль роли conditera_app"
check_required "BACKUP_DATABASE_PASSWORD" "отдельный пароль роли conditera_backup"
check_required "POSTGRES_PASSWORD" "административный пароль PostgreSQL"
check_required "NEXT_PUBLIC_SUPABASE_URL" "URL Kong/Supabase (клиент)"
check_required "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Anon key (клиент, RLS)"
check_required "SUPABASE_SERVICE_ROLE_KEY" "Service role key (server-only, обход RLS)"

DB_URL=$(get_env "DATABASE_URL")
DIRECT_DB_URL=$(get_env "DIRECT_DATABASE_URL")
BACKUP_DB_URL=$(get_env "BACKUP_DATABASE_URL")
if [[ "$DB_URL" == file:* ]]; then
  err "DATABASE_URL начинается с 'file:' — требуется PostgreSQL URL"
fi
if [ "$MODE_LABEL" = "production" ]; then
  check_secret_value "APP_DATABASE_PASSWORD" "$(get_env "APP_DATABASE_PASSWORD")" 32
  check_secret_value "BACKUP_DATABASE_PASSWORD" "$(get_env "BACKUP_DATABASE_PASSWORD")" 32
  check_secret_value "POSTGRES_PASSWORD" "$(get_env "POSTGRES_PASSWORD")" 32
  validate_database_url "DATABASE_URL" "$DB_URL" "conditera_app" "${APP_DATABASE_PASSWORD}"
  validate_database_url "DIRECT_DATABASE_URL" "$DIRECT_DB_URL" "conditera_app" "${APP_DATABASE_PASSWORD}"
  validate_database_url "BACKUP_DATABASE_URL" "$BACKUP_DB_URL" "conditera_backup" "${BACKUP_DATABASE_PASSWORD}"
fi
echo ""

# ===== Auth / Security =====
echo -e "${BOLD}[AUTH / SECURITY] ${NC}"
check_required "JWT_SECRET" "секрет подписи access-токенов"
check_required "JWT_REFRESH_SECRET" "отдельный секрет refresh-токенов"
check_required "TFA_ENCRYPTION_KEY" "отдельный AES-256-GCM ключ TOTP"
check_required "CRON_SECRET" "секрет для cron-задач"
if [ "$MODE_LABEL" = "production" ]; then
  check_secret_value "JWT_SECRET" "$(get_env "JWT_SECRET")" 32
  check_secret_value "JWT_REFRESH_SECRET" "$(get_env "JWT_REFRESH_SECRET")" 32
  check_secret_value "TFA_ENCRYPTION_KEY" "$(get_env "TFA_ENCRYPTION_KEY")" 64
  check_secret_value "CRON_SECRET" "$(get_env "CRON_SECRET")" 32
  TFA_VALUE=$(get_env "TFA_ENCRYPTION_KEY")
  if [[ ! "$TFA_VALUE" =~ ^[a-fA-F0-9]{64}$ ]]; then
    err "TFA_ENCRYPTION_KEY должен содержать ровно 64 hex-символа"
  fi
  JWT_VALUE=$(get_env "JWT_SECRET")
  REFRESH_VALUE=$(get_env "JWT_REFRESH_SECRET")
  CRON_VALUE=$(get_env "CRON_SECRET")
  if [ "$JWT_VALUE" = "$REFRESH_VALUE" ]; then
    err "JWT_SECRET и JWT_REFRESH_SECRET должны быть разными"
  fi
  if [ "$TFA_VALUE" = "$JWT_VALUE" ] || [ "$TFA_VALUE" = "$REFRESH_VALUE" ]; then
    err "TFA_ENCRYPTION_KEY должен отличаться от JWT-секретов"
  fi
  if [ "$CRON_VALUE" = "$JWT_VALUE" ] || [ "$CRON_VALUE" = "$REFRESH_VALUE" ] || [ "$CRON_VALUE" = "$TFA_VALUE" ]; then
    err "CRON_SECRET должен отличаться от JWT/TFA секретов"
  fi
fi
echo ""

# ===== Yandex Metrika =====
echo -e "${BOLD}[YANDEX METRIKA — аналитика]${NC}"
check_required "NEXT_PUBLIC_YANDEX_METRIKA_ID" "ID счётчика Метрики (проект Уездный кондитер: 111432662)"
check_optional "YANDEX_METRIKA_OAUTH_TOKEN" "токен для server-side tracking (офлайн-конверсии)"
check_optional "YANDEX_GEOCODER_API_KEY" "API-ключ Геокодера (определение координат)"
echo ""

# ===== OAuth =====
echo -e "${BOLD}[OAUTH — вход через соцсети] ${NC}"
if [ "$MODE_LABEL" = "production" ]; then
  check_required "YANDEX_CLIENT_ID" "Yandex OAuth client ID"
  check_required "YANDEX_CLIENT_SECRET" "Yandex OAuth client secret"
  check_required "YANDEX_OAUTH_REDIRECT" "Yandex OAuth callback URL"
  check_required "GOOGLE_CLIENT_ID" "Google OAuth client ID"
  check_required "GOOGLE_CLIENT_SECRET" "Google OAuth client secret"
  check_required "GOOGLE_OAUTH_REDIRECT" "Google OAuth callback URL"
  check_required "VK_CLIENT_ID" "VK ID client ID"
  check_required "VK_OAUTH_REDIRECT" "VK ID callback URL"
  if [ "$(get_env "YANDEX_OAUTH_REDIRECT")" != "https://conditera.ru/api/auth/oauth/yandex/callback" ]; then
    err "YANDEX_OAUTH_REDIRECT должен указывать на production callback Conditera"
  fi
  if [ "$(get_env "GOOGLE_OAUTH_REDIRECT")" != "https://conditera.ru/api/auth/oauth/google/callback" ]; then
    err "GOOGLE_OAUTH_REDIRECT должен указывать на production callback Conditera"
  fi
  if [ "$(get_env "VK_OAUTH_REDIRECT")" != "https://conditera.ru/api/auth/oauth/vk/callback" ]; then
    err "VK_OAUTH_REDIRECT должен указывать на production callback Conditera"
  fi
else
  check_optional "YANDEX_CLIENT_ID" "Yandex OAuth client ID"
  check_optional "GOOGLE_CLIENT_ID" "Google OAuth client ID"
  check_optional "VK_CLIENT_ID" "VK ID client ID"
fi
echo ""

# ===== Telegram =====
echo -e "${BOLD}[TELEGRAM]${NC}"
check_optional "TELEGRAM_BOT_TOKEN" "токен Telegram-бота"
check_optional "TELEGRAM_CHANNEL_ID" "ID канала для уведомлений"
check_optional "TELEGRAM_OAUTH_REDIRECT" "redirect для Telegram Login"
echo ""

# ===== YooKassa =====
echo -e "${BOLD}[YOOKASSA — платежи]${NC}"
check_required "YOOKASSA_SHOP_ID" "Shop ID от YooKassa"
check_required "YOOKASSA_SECRET_KEY" "Secret Key от YooKassa"
echo ""

# ===== SMTP =====
echo -e "${BOLD}[SMTP — почта]${NC}"
check_required "SMTP_HOST" "SMTP-сервер"
check_required "SMTP_FROM" "адрес отправителя"
if [ "$MODE_LABEL" = "production" ]; then
  check_required "SMTP_PORT" "порт SMTP"
  check_required "SMTP_SECURE" "true для 465, false для 587"
fi
echo ""

# ===== Supabase Storage =====
echo -e "${BOLD}[SUPABASE STORAGE]${NC}"
check_optional "SUPABASE_STORAGE_HOSTNAME" "кастомный домен CDN (если self-hosted prod)"
check_required "STORAGE_BUCKET_AVATARS" "имя бакета для аватаров"
check_required "STORAGE_BUCKET_PORTFOLIO" "имя бакета для портфолио"
echo ""

# ===== MAIL PROFILE (DEV-16) — только при явном запросе профиля mail/full =====
if [ "$PROFILE" = "mail" ] || [ "$PROFILE" = "full" ]; then
  echo -e "${BOLD}[MAIL PROFILE: $PROFILE]${NC}"
  if [ -f "mailu.env" ]; then
    log "mailu.env найден (env_file сервиса mailu; значения не проверяются и не печатаются)"
    if ! grep -Eq '^SECRET_KEY=[0-9a-fA-F]{64}[[:space:]]*$' mailu.env; then
      warn "mailu.env: SECRET_KEY отсутствует или не 64-hex — сгенерируйте: openssl rand -hex 32 (advisory)"
    fi
  else
    warn "mailu.env ОТСУТСТВУЕТ — 'docker compose --profile $PROFILE up -d' упадёт на env_file (env file mailu.env not found)."
    warn "Дефолтный профиль это НЕ ломает: сервис mailu под профилями [mail, full] (docker-compose.yml). Шаблон: mailu.env.template"
  fi
  echo ""
fi

# ===== ИТОГ =====
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
if [ $ERRORS -gt 0 ]; then
  echo -e "  ${RED}${BOLD}ОШИБОК: $ERRORS${NC}  ${YELLOW}Предупреждений: $WARNINGS${NC}"
  echo ""
  echo -e "  ${RED}Запуск невозможен без исправления ошибок.${NC}"
  echo ""
  echo "  Чтобы заполнить недостающие:"
  echo -e "    ${BOLD}bash scripts/setup-env.sh $MODE${NC}"
  echo ""
  exit 1
else
  if [ $WARNINGS -gt 0 ]; then
    echo -e "  ${GREEN}${BOLD}Ошибок нет.${NC}  ${YELLOW}Предупреждений: $WARNINGS${NC}"
    echo ""
    echo "  Предупреждения — это опциональные функции (OAuth, YooKassa, Telegram)."
    echo "  Запуск возможен, но соответствующие функции будут отключены."
  else
    echo -e "  ${GREEN}${BOLD}Все обязательные переменные заполнены.${NC}"
    echo ""
    echo "  Готово к запуску!"
  fi
  echo ""
  echo -e "  Следующий шаг:"
  if [ "$MODE_LABEL" = "production" ]; then
    echo -e "    ${BOLD}bash scripts/deploy.sh${NC}"
  else
    echo -e "    ${BOLD}npm run dev:local${NC}"
  fi
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  exit 0
fi
