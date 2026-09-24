#!/usr/bin/env bash
# ====================================================================
# scripts/setup-github-secrets.sh
# ====================================================================
# Помощник для добавления GitHub Secrets через `gh` CLI.
#
# Требования:
#   1. Установлен GitHub CLI: https://cli.github.com/  (sudo apt install gh)
#   2. Авторизован: gh auth login
#   3. Репозиторий склонирован и gh знает о нём (gh repo set-default)
#
# Использование:
#   ./scripts/setup-github-secrets.sh
#
# Скрипт читает значения из .env.production и добавляет их в GitHub Secrets.
# Значения, которые пустые в .env.production — пропускаются.
# ====================================================================
set -euo pipefail

ENV_FILE="${1:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Файл $ENV_FILE не найден."
  echo "   Скопируй .env.production.template в .env.production и заполни значения."
  exit 1
fi

if ! command -v gh &> /dev/null; then
  echo "❌ GitHub CLI (gh) не установлен."
  echo "   Установи: https://cli.github.com/"
  exit 1
fi

if ! gh auth status &> /dev/null; then
  echo "❌ Не авторизован в GitHub CLI."
  echo "   Запусти: gh auth login"
  exit 1
fi

# Список секретов, которые нужно добавить в GitHub
# (имя в .env.production = имя в GitHub Secrets)
SECRETS=(
  "POSTGRES_PASSWORD"
  "JWT_SECRET"
  "TFA_ENCRYPTION_KEY"
  "CRON_SECRET"
  "IP_HASH_SALT"
  "YOOKASSA_SHOP_ID"
  "YOOKASSA_SECRET_KEY"
  "DADATA_API_KEY"
  "DADATA_SECRET_KEY"
  "N8N_ADMIN_PASSWORD"
  "SIMPLEX_HOSTNAME"
  "SIMPLEX_BRIDGE_API_KEY"
  "SENTRY_DSN"
  "NEXT_PUBLIC_SENTRY_DSN"
  "SMTP_HOST"
  "SMTP_USER"
  "SMTP_PASSWORD"
  "TELEGRAM_BOT_TOKEN"
)

echo "🔑 Добавляю GitHub Secrets из $ENV_FILE..."
echo ""

ADDED=0
SKIPPED=0

for SECRET in "${SECRETS[@]}"; do
  # Читаем значение из .env.production (игнорируя комментарии и пустые строки)
  VALUE=$(grep -E "^${SECRET}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- | sed 's/^"//;s/"$//' || true)

  if [ -z "$VALUE" ]; then
    echo "   ⏭️  $SECRET — пусто, пропускается"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Добавляем секрет через gh CLI
  if echo -n "$VALUE" | gh secret set "$SECRET" 2>/dev/null; then
    echo "   ✅ $SECRET — добавлен"
    ADDED=$((ADDED + 1))
  else
    echo "   ❌ $SECRET — ошибка при добавлении"
  fi
done

echo ""
echo "📊 Итог:"
echo "   ✅ Добавлено: $ADDED"
echo "   ⏭️  Пропущено (пустые): $SKIPPED"
echo ""
echo "Список всех GitHub Secrets:"
gh secret list
