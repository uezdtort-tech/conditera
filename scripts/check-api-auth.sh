#!/bin/bash
# ============================================================
# scripts/check-api-auth.sh — CI-гейт: POST/PATCH/DELETE/PUT
# route.ts без признаков auth/secret.
#
# Основан на аудите «API routes без авторизации» (сентябрь 2026).
# Whitelist: auth flow, webhooks, публичные списки, AI rate-limited.
# Выход: 0 — всё покрыто; 1 — найдены непокрытые mutation-роуты.
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/.."

# Маркеры авторизации/защиты (любой из них считается достаточным)
AUTH_PATTERN='getCurrentUser|getUserFromRequest|getSession|requireRole|unauthorizedResponse|verifyCronSecret|verifyCronSecret|X-Cron-Secret|X-N8N-Secret|X-Bot-Secret|X-Bridge-Api-Key|X-Telegram-Bot-Api-Secret-Token|verifyWebhook|verifyMailgun|verifySignature|timingSafeEqual|enforceRateLimit|checkFraudLimit|supabase\.auth\.'

# Whitelist: route.ts, которым auth не нужен (public/auth-flow/webhook)
WHITELIST=(
  'api/auth/'
  'webhook'
  'oauth'
  'csrf-token'
  'notifications/vapid-key'
  'simplex/support-address'
  'telegram/webapp'
  'email/health'
)

violations=0
checked=0

while IFS= read -r f; do
  # Есть ли вообще mutation-обработчик?
  if ! rg -q 'export async function (POST|PATCH|DELETE|PUT)' "$f"; then
    continue
  fi
  checked=$((checked + 1))

  # Уже защищён?
  if rg -q "$AUTH_PATTERN" "$f"; then
    continue
  fi

  # Whitelist по подстроке пути
  wl=0
  for w in "${WHITELIST[@]}"; do
    if [[ "$f" == *"$w"* ]]; then
      wl=1
      break
    fi
  done
  [ "$wl" -eq 1 ] && continue

  echo "UNPROTECTED MUTATION: $f"
  violations=$((violations + 1))
done < <(find src/app/api -name route.ts | sort)

echo ""
echo "Проверено mutation-роутов: ${checked}; непокрытых: ${violations}"

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "❌ FAIL: добавьте auth (getCurrentUser/verifyCronSecret/shared secret)"
  echo "   или rate-limit (enforceRateLimit) в перечисленные роуты,"
  echo "   либо расширьте WHITELIST с обоснованием в PR."
  exit 1
fi

echo "✅ OK: все mutation-роуты имеют признак auth/secret/rate-limit или в whitelist"
