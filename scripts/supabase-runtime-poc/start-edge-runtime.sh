#!/bin/sh
set -eu

root="${SUPABASE_RUNTIME_ROOT:-/opt/supabase/services}/edge-runtime"
if [ ! -x "$root/usr/local/bin/edge-runtime" ]; then
  echo "Edge Runtime binary is missing from $root" >&2
  exit 1
fi
if [ ! -d "$root/home/deno/functions/main" ]; then
  echo "Edge Runtime main worker is missing" >&2
  exit 1
fi

mkdir -p "$root/root/.cache/deno"
# Deno's Rust runtime resolves its own executable through /proc/self/exe.
# The service root is intentionally isolated with chroot and does not receive
# a host /proc mount (mounting proc would require CAP_SYS_ADMIN). Provide the
# stable executable path expected by this single-purpose chroot process.
mkdir -p "$root/proc/self"
ln -sfn /usr/local/bin/edge-runtime "$root/proc/self/exe"

# chroot has its own /etc tree; copy Docker's runtime DNS configuration so
# Deno can resolve JSR/ESM dependencies on first worker start.
mkdir -p "$root/etc"
if [ -f /etc/resolv.conf ]; then
  rm -f "$root/etc/resolv.conf"
  cp /etc/resolv.conf "$root/etc/resolv.conf"
fi
if [ -f /etc/hosts ]; then
  rm -f "$root/etc/hosts"
  cp /etc/hosts "$root/etc/hosts"
fi

# Pass only Edge Runtime/function secrets. In particular, never expose the
# PostgreSQL superuser or Conditera DB password to user function workers.
exec env -i \
  PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  DENO_DIR=/root/.cache/deno \
  JWT_SECRET="$JWT_SECRET" \
  VERIFY_JWT=true \
  SUPABASE_URL=http://127.0.0.1:8000 \
  SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}" \
  SUPABASE_ANON_KEY="$ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}" \
  TELEGRAM_CHANNEL_ID="${TELEGRAM_CHANNEL_ID:-@conditera}" \
  TELEGRAM_WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-}" \
  YOOKASSA_WEBHOOK_SECRET="${YOOKASSA_WEBHOOK_SECRET:-}" \
  YOOKASSA_SHOP_ID="${YOOKASSA_SHOP_ID:-}" \
  YOOKASSA_SECRET_KEY="${YOOKASSA_SECRET_KEY:-}" \
  SMTP_HOST="${SMTP_HOST:-}" \
  SMTP_PORT="${SMTP_PORT:-587}" \
  SMTP_USER="${SMTP_USER:-}" \
  SMTP_PASSWORD="${SMTP_PASSWORD:-}" \
  SMTP_SENDER_NAME="${SMTP_SENDER_NAME:-Conditera}" \
  SMTP_ADMIN_EMAIL="${SMTP_ADMIN_EMAIL:-noreply@conditera.ru}" \
  VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-}" \
  VAPID_PRIVATE_KEY="${VAPID_PRIVATE_KEY:-}" \
  VAPID_SUBJECT="${VAPID_SUBJECT:-mailto:support@conditera.ru}" \
  RESEND_API_KEY="${RESEND_API_KEY:-}" \
  PORT=9000 \
  chroot "$root" /usr/local/bin/edge-runtime start \
    --main-service /home/deno/functions/main \
    --user-worker-request-idle-timeout 150000
