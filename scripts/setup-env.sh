#!/usr/bin/env bash
# ============================================================
# setup-env.sh — Интерактивный мастер настройки .env
# ============================================================
# Использование:
#   bash scripts/setup-env.sh dev      # создаёт .env.local
#   bash scripts/setup-env.sh prod     # создаёт .env.production
#   bash scripts/setup-env.sh --check # только проверка без создания
#
# Что делает:
#   1. Если файл уже существует — спрашивает "обновить или сохранить"
#   2. Копирует .env.{mode}.example → .env.{mode}
#   3. Сохраняет уже заполненные пользователем значения
#   4. Интерактивно спрашивает ключевые поля: Yandex Metrika ID, OAuth и т.д.
#   5. Записывает в .env.{mode} с реальными значениями
#   6. В конце запускает env-check.sh
# ============================================================

set -euo pipefail

MODE="${1:-dev}"
BACKUP=""
if [ "$MODE" = "--check" ]; then
  bash scripts/env-check.sh
  exit 0
fi

if [ "$MODE" != "dev" ] && [ "$MODE" != "prod" ]; then
  echo "Usage: bash scripts/setup-env.sh [dev|prod|--check]"
  exit 1
fi

if [ "$MODE" = "dev" ]; then
  ENV_FILE=".env.local"
  TEMPLATE=".env.local.example"
  APP_URL="http://localhost:3000"
else
  ENV_FILE=".env.production"
  TEMPLATE=".env.production.example"
  APP_URL="https://conditera.ru"
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
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }

# Проверяем что мы в корне проекта
if [ ! -f "package.json" ]; then
  err "Запустите из корня проекта (нужен package.json)."
  exit 1
fi

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Setup environment: $MODE${NC}"
echo -e "${BOLD}  Target file: $ENV_FILE${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""

# === Backup existing ===
if [ -f "$ENV_FILE" ]; then
  BACKUP="${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
  warn "Файл $ENV_FILE уже существует."
  echo "  Будет создан бэкап: $BACKUP"
  echo ""
  read -p "  Продолжить? (yes/no) " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Отменено пользователем."
    exit 0
  fi
  cp "$ENV_FILE" "$BACKUP"
  log "Бэкап создан: $BACKUP"
fi

# === Parse existing values (to preserve user input) ===
declare -A EXISTING_VALUES
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    # Strip leading/trailing whitespace from value
    value=$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    EXISTING_VALUES["$key"]="$value"
  done < "$ENV_FILE"
fi

# === Helper: ask for value with default and preserved-existing-preference ===
ask_value() {
  local prompt="$1"
  local var_name="$2"
  local default="$3"
  local existing="${EXISTING_VALUES[$var_name]:-}"

  local display_default="$default"
  if [ -n "$existing" ] && [ "$existing" != "$default" ]; then
    display_default="$existing"
    echo -e "  ${BLUE}$prompt${NC}" >&2
    echo -e "  Текущее значение в файле: ${GREEN}${existing}${NC}" >&2
    read -p "  Новое значение (Enter=оставить текущее): " input >&2
    if [ -z "$input" ]; then
      echo "$existing"
    else
      echo "$input"
    fi
  else
    echo -e "  ${BLUE}$prompt${NC}" >&2
    read -p "  Значение [default: $default]: " input >&2
    if [ -z "$input" ]; then
      echo "$default"
    else
      echo "$input"
    fi
  fi
}

# Ввод секрета без отображения значения и без печати сохранённого секрета.
ask_secret_value() {
  local prompt="$1"
  local var_name="$2"
  local default="$3"
  local existing="${EXISTING_VALUES[$var_name]:-}"
  local input=""

  echo -e "  ${BLUE}$prompt${NC}" >&2
  if [ -n "$existing" ] && [ "$existing" != "$default" ]; then
    echo "  Текущее значение уже задано (скрыто)." >&2
    read -r -s -p "  Новое значение (Enter=оставить текущее): " input >&2
    printf '\\n' >&2
    if [ -z "$input" ]; then echo "$existing"; else echo "$input"; fi
  else
    read -r -s -p "  Значение (Enter=пропустить): " input >&2
    printf '\\n' >&2
    if [ -z "$input" ]; then echo "$default"; else echo "$input"; fi
  fi
}

# Безопасно обновить значение без порчи &, | и обратных слешей.
set_env_value() {
  local key="$1"
  local value="$2"
  local escaped_value
  if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    err "Недопустимое имя переменной окружения: $key"
    return 1
  fi
  escaped_value=$(printf '%s' "$value" | sed -e 's/[\\&|]/\\&/g')
  if grep -qE "^$key=" "$ENV_FILE"; then
    sed -i.bak "s|^$key=.*|$key=$escaped_value|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# === Start from template ===
log "Создаём $ENV_FILE из $TEMPLATE"
cp "$TEMPLATE" "$ENV_FILE"
if [ -n "$BACKUP" ] && [ -f "$BACKUP" ]; then
  bash scripts/restore-env-values.sh "$BACKUP" "$ENV_FILE"
  log "Существующие непустые значения сохранены из бэкапа."
fi

echo ""
echo -e "${BOLD}=== КРИТИЧЕСКИЕ ЗНАЧЕНИЯ ===${NC}"
echo ""

# YANDEX METRIKA — pre-fill with 111432662 (user's actual counter ID)
info "Яндекс.Метрика — ID счётчика проекта: 111432662"
METRIKA_ID=$(ask_value "Yandex Metrika ID" "NEXT_PUBLIC_YANDEX_METRIKA_ID" "111432662")
# Убираем возможные trailing newlines/whitespace (защита от sed injection)
METRIKA_ID=$(echo "$METRIKA_ID" | tr -d '\n' | xargs)
set_env_value NEXT_PUBLIC_YANDEX_METRIKA_ID "$METRIKA_ID"
log "NEXT_PUBLIC_YANDEX_METRIKA_ID = ${METRIKA_ID}"

# YANDEX METRIKA OAuth token (server-side tracking)
info "Yandex Metrika OAuth token — для server-side tracking (необязательно)"
echo "  Получить: https://oauth.yandex.ru/ → выдать права metrica:write"
METRIKA_TOKEN=$(ask_secret_value "Yandex Metrika OAuth token (Enter=пропустить)" "YANDEX_METRIKA_OAUTH_TOKEN" "")
if [ -n "$METRIKA_TOKEN" ]; then
  set_env_value YANDEX_METRIKA_OAUTH_TOKEN "$METRIKA_TOKEN"
  log "YANDEX_METRIKA_OAUTH_TOKEN = [hidden]"
fi

# Yandex Geocoder API key
info "Yandex Geocoder API key — для определения координат по адресу"
echo "  Получить: https://developer.tech.yandex.ru/services/ → Геокодер"
GEO_KEY=$(ask_secret_value "Yandex Geocoder API key (Enter=пропустить)" "YANDEX_GEOCODER_API_KEY" "")
if [ -n "$GEO_KEY" ]; then
  set_env_value YANDEX_GEOCODER_API_KEY "$GEO_KEY"
  log "YANDEX_GEOCODER_API_KEY = [hidden]"
fi

# YANDEX OAuth (client_id + redirect)
echo ""
info "Yandex OAuth — для кнопки «Войти через Яндекс» в auth-modal"
echo "  Создать приложение: https://oauth.yandex.ru/client/new"
echo "  Redirect URI для $MODE: ${APP_URL}/api/auth/oauth/yandex/callback"
YANDEX_CID=$(ask_value "Yandex OAuth Client ID (Enter=пропустить)" "YANDEX_CLIENT_ID" "")
if [ -n "$YANDEX_CID" ]; then
  set_env_value YANDEX_CLIENT_ID "$YANDEX_CID"
  log "YANDEX_CLIENT_ID = [hidden]"
  set_env_value YANDEX_OAUTH_REDIRECT "${APP_URL}/api/auth/oauth/yandex/callback"
  log "YANDEX_OAUTH_REDIRECT = ${APP_URL}/api/auth/oauth/yandex/callback"
fi

# GOOGLE OAuth
echo ""
info "Google OAuth — для кнопки «Войти через Google» в auth-modal"
echo "  Создать: https://console.cloud.google.com/apis/credentials"
GOOGLE_CID=$(ask_value "Google OAuth Client ID (Enter=пропустить)" "GOOGLE_CLIENT_ID" "")
if [ -n "$GOOGLE_CID" ]; then
  set_env_value GOOGLE_CLIENT_ID "$GOOGLE_CID"
  GOOGLE_SECRET=$(ask_secret_value "Google OAuth Client Secret (Enter=пропустить)" "GOOGLE_CLIENT_SECRET" "")
  if [ -n "$GOOGLE_SECRET" ]; then set_env_value GOOGLE_CLIENT_SECRET "$GOOGLE_SECRET"; fi
  set_env_value GOOGLE_OAUTH_REDIRECT "${APP_URL}/api/auth/oauth/google/callback"
  log "Google OAuth настроен"
fi

# VK OAuth
echo ""
info "VK OAuth — для кнопки «Войти через VK» в auth-modal"
echo "  Создать: https://dev.vk.com/"
VK_CID=$(ask_value "VK OAuth Client ID (Enter=пропустить)" "VK_CLIENT_ID" "")
if [ -n "$VK_CID" ]; then
  set_env_value VK_CLIENT_ID "$VK_CID"
  set_env_value VK_OAUTH_REDIRECT "${APP_URL}/api/auth/oauth/vk/callback"
  log "VK OAuth настроен"
fi

# Telegram
echo ""
info "Telegram — бот + Login Widget"
TG_TOKEN=$(ask_secret_value "Telegram Bot Token (Enter=пропустить)" "TELEGRAM_BOT_TOKEN" "")
if [ -n "$TG_TOKEN" ]; then
  set_env_value TELEGRAM_BOT_TOKEN "$TG_TOKEN"
  log "TELEGRAM_BOT_TOKEN = [hidden]"
fi
TG_CHANNEL=$(ask_value "Telegram Channel ID (Enter=пропустить)" "TELEGRAM_CHANNEL_ID" "")
if [ -n "$TG_CHANNEL" ]; then
  set_env_value TELEGRAM_CHANNEL_ID "$TG_CHANNEL"
fi

# SMTP — обязателен для production-транзакционных писем.
if [ "$MODE" = "prod" ]; then
  echo ""
  info "SMTP — обязательная отправка писем регистрации, заказов и уведомлений"
  SMTP_HOST_VALUE=$(ask_value "SMTP host" "SMTP_HOST" "mail.conditera.ru")
  SMTP_USER_VALUE=$(ask_value "SMTP user" "SMTP_USER" "noreply@conditera.ru")
  SMTP_PASSWORD_VALUE=$(ask_secret_value "SMTP password" "SMTP_PASSWORD" "")
  SMTP_PORT_VALUE=$(ask_value "SMTP port" "SMTP_PORT" "465")
  SMTP_SECURE_VALUE=$(ask_value "SMTP secure (true для 465, false для 587)" "SMTP_SECURE" "true")
  set_env_value SMTP_HOST "$SMTP_HOST_VALUE"
  set_env_value SMTP_USER "$SMTP_USER_VALUE"
  if [ -n "$SMTP_PASSWORD_VALUE" ]; then set_env_value SMTP_PASSWORD "$SMTP_PASSWORD_VALUE"; fi
  set_env_value SMTP_PORT "$SMTP_PORT_VALUE"
  set_env_value SMTP_SECURE "$SMTP_SECURE_VALUE"
fi

# YooKassa
echo ""
info "YooKassa — для приёма платежей"
echo "  https://yookassa.ru/my-account/settings"
YK_SHOP=$(ask_value "YooKassa Shop ID (Enter=пропустить)" "YOOKASSA_SHOP_ID" "")
if [ -n "$YK_SHOP" ]; then
  set_env_value YOOKASSA_SHOP_ID "$YK_SHOP"
  YK_KEY=$(ask_secret_value "YooKassa Secret Key (Enter=пропустить)" "YOOKASSA_SECRET_KEY" "")
  if [ -n "$YK_KEY" ]; then
    set_env_value YOOKASSA_SECRET_KEY "$YK_KEY"
  fi
  log "YooKassa настроена"
fi

# Remove sed backup files
rm -f "${ENV_FILE}.bak"

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
log "Файл $ENV_FILE создан/обновлён."
echo ""
echo -e "  Следующий шаг:  ${BOLD}bash scripts/env-check.sh $MODE${NC}"
echo -e "  Это покажет какие переменные ещё нужно заполнить."
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
