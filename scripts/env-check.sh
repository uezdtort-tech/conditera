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
  local normalized
  normalized="$(printf '%s' "$val" | tr '[:upper:]' '[:lower:]')"
  [ -n "$normalized" ] || return 1

  case "$normalized" in
    stub_*|change_me*|fallback-*|build-placeholder*|dummy*|your_*|example*)
      return 1
      ;;
    dev_*|dev-*)
      [ "$MODE_LABEL" != "production" ] || return 1
      ;;
  esac
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
echo -e "${BOLD}[DATABASE]${NC}"
check_required "DATABASE_URL" "URL подключения к PostgreSQL"
check_required "NEXT_PUBLIC_SUPABASE_URL" "URL Kong/Supabase (клиент)"
SUPABASE_URL_VALUE=$(get_env "NEXT_PUBLIC_SUPABASE_URL")
if is_filled "$SUPABASE_URL_VALUE" && ! [[ "$SUPABASE_URL_VALUE" =~ ^https?:// ]]; then
  err "NEXT_PUBLIC_SUPABASE_URL должен быть абсолютным http(s) URL"
fi
if [ "$MODE_LABEL" = "production" ] && [[ "$SUPABASE_URL_VALUE" =~ ^http://(localhost|127\\.0\\.0\\.1)(:|/|$) ]]; then
  err "Production NEXT_PUBLIC_SUPABASE_URL не может указывать на localhost"
fi
check_required "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Anon key (клиент, RLS)"
check_required "SUPABASE_SERVICE_ROLE_KEY" "Service role key (server-only, обход RLS)"
if [ "$MODE_LABEL" = "production" ]; then
  check_required "POSTGRES_PASSWORD" "пароль PostgreSQL для self-hosted"
fi
echo ""

# Специфичная проверка: DATABASE_URL не должен быть file: (prisma.config.ts бросит)
DB_URL=$(get_env "DATABASE_URL")
if [[ "$DB_URL" == file:* ]]; then
  err "DATABASE_URL начинается с 'file:' — prisma.config.ts отклонит. Замените на postgresql://"
fi
echo ""

# ===== Auth / Security =====
echo -e "${BOLD}[AUTH / SECURITY]${NC}"
check_required "JWT_SECRET" "секрет для подписи JWT"
check_required "JWT_REFRESH_SECRET" "отдельный секрет для refresh-токенов"
check_required "TFA_ENCRYPTION_KEY" "ключ шифрования 2FA backup codes"
check_required "CRON_SECRET" "секрет для cron-задач"

JWT=$(get_env "JWT_SECRET")
JWT_REFRESH=$(get_env "JWT_REFRESH_SECRET")
TFA=$(get_env "TFA_ENCRYPTION_KEY")

for secret_name in JWT_SECRET JWT_REFRESH_SECRET; do
  secret_value="$(get_env "$secret_name")"
  if is_filled "$secret_value" && [ "${#secret_value}" -lt 32 ]; then
    err "$secret_name короче 32 символов"
  fi
done

if [ "$MODE_LABEL" = "production" ] && is_filled "$TFA"; then
  if ! [[ "$TFA" =~ ^[A-Fa-f0-9]{64}$ ]]; then
    err "TFA_ENCRYPTION_KEY должен содержать ровно 64 hex-символа (32 байта)"
  fi
fi

if [ "$MODE_LABEL" = "production" ]; then
  APP_URL=$(get_env "NEXT_PUBLIC_APP_URL")
  check_required "NEXT_PUBLIC_APP_URL" "публичный HTTPS URL приложения"
  if is_filled "$APP_URL" && [[ "$APP_URL" != https://* ]]; then
    err "NEXT_PUBLIC_APP_URL должен начинаться с https:// в production"
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
echo -e "${BOLD}[OAUTH — вход через соцсети]${NC}"
check_optional "YANDEX_CLIENT_ID" "Yandex OAuth — кнопка «Войти через Яндекс»"
check_optional "YANDEX_OAUTH_REDIRECT" "Yandex OAuth — redirect URI"
check_optional "GOOGLE_CLIENT_ID" "Google OAuth — кнопка «Войти через Google»"
check_optional "GOOGLE_OAUTH_REDIRECT" "Google OAuth — redirect URI"
check_optional "VK_CLIENT_ID" "VK OAuth — кнопка «Войти через VK»"
check_optional "VK_OAUTH_REDIRECT" "VK OAuth — redirect URI"
echo ""

# ===== Telegram =====
echo -e "${BOLD}[TELEGRAM]${NC}"
check_optional "TELEGRAM_BOT_TOKEN" "токен Telegram-бота"
check_optional "TELEGRAM_CHANNEL_ID" "ID канала для уведомлений"
check_optional "TELEGRAM_OAUTH_REDIRECT" "redirect для Telegram Login"
echo ""

# ===== YooKassa =====
echo -e "${BOLD}[YOOKASSA — платежи]${NC}"
check_optional "YOOKASSA_SHOP_ID" "Shop ID от YooKassa"
check_optional "YOOKASSA_SECRET_KEY" "Secret Key от YooKassa"
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
