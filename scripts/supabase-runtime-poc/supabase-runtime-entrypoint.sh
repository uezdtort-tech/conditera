#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
# Postgres-specific environment is set by start-postgres.sh from the image contract.
: "${JWT_SECRET:?JWT_SECRET is required}"
: "${ANON_KEY:?ANON_KEY is required}"
: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY is required}"
: "${SECRET_KEY_BASE:?SECRET_KEY_BASE is required}"
: "${PG_META_CRYPTO_KEY:?PG_META_CRYPTO_KEY is required}"
: "${REALTIME_DB_ENC_KEY:?REALTIME_DB_ENC_KEY is required}"
: "${REALTIME_DB_ENC_KEY_GCM:?REALTIME_DB_ENC_KEY_GCM is required}"
if [ "${#REALTIME_DB_ENC_KEY}" -ne 16 ]; then
  echo "REALTIME_DB_ENC_KEY must contain exactly 16 characters (AES-128 legacy key)" >&2
  exit 1
fi
if [ "${#REALTIME_DB_ENC_KEY_GCM}" -ne 32 ]; then
  echo "REALTIME_DB_ENC_KEY_GCM must contain exactly 32 characters (AES-256-GCM key)" >&2
  exit 1
fi

export POSTGRES_USER="${POSTGRES_USER:-supabase_admin}"
export POSTGRES_DB="${POSTGRES_DB:-supabase}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
# Preserve the official Supabase Postgres image data path inside chroot.
export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
export API_EXTERNAL_URL="${API_EXTERNAL_URL:-http://localhost:8000}"
export SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-$API_EXTERNAL_URL}"
export SITE_URL="${SITE_URL:-http://localhost:3000}"
export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?search_path=auth"
export GOTRUE_DB_DRIVER=postgres
export GOTRUE_DB_MIGRATIONS_PATH=/usr/local/etc/auth/migrations
export GOTRUE_API_HOST=127.0.0.1
export GOTRUE_JWT_SECRET="$JWT_SECRET"
export PGRST_DB_URI="postgres://authenticator:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
export PGRST_JWT_SECRET="$JWT_SECRET"
export DATABASE_URL="postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?search_path=storage"
export DB_HOST=127.0.0.1
export DB_PORT="$POSTGRES_PORT"
export DB_USER=supabase_admin
export DB_PASSWORD="$POSTGRES_PASSWORD"
export DB_NAME="$POSTGRES_DB"
export DB_AFTER_CONNECT_QUERY="SET search_path TO _realtime"
export API_JWT_SECRET="$JWT_SECRET"
export METRICS_JWT_SECRET="$JWT_SECRET"
export DB_ENC_KEY="$REALTIME_DB_ENC_KEY"
export DB_ENC_KEY_GCM="$REALTIME_DB_ENC_KEY_GCM"
export DB_ENC_WRITE_GCM=true
export ELIXIR_ERL_OPTIONS="${ELIXIR_ERL_OPTIONS:-+fnu}"
export GOTRUE_JWT_ISSUER="$API_EXTERNAL_URL/auth/v1"
export GOTRUE_SITE_URL="$SITE_URL"
export GOTRUE_JWT_EXP="${JWT_EXPIRY:-3600}"
export GOTRUE_JWT_ADMIN_ROLES=service_role
export GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_EXTERNAL_EMAIL_ENABLED="${GOTRUE_EXTERNAL_EMAIL_ENABLED:-true}"
export GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false
export GOTRUE_MAILER_AUTOCONFIRM="${GOTRUE_MAILER_AUTOCONFIRM:-false}"
export GOTRUE_DISABLE_SIGNUP="${GOTRUE_DISABLE_SIGNUP:-false}"
export GOTRUE_URI_ALLOW_LIST="${ADDITIONAL_REDIRECT_URLS:-}"
export GOTRUE_SMTP_ADMIN_EMAIL="${SMTP_ADMIN_EMAIL:-noreply@conditera.ru}"
export GOTRUE_SMTP_HOST="${SMTP_HOST:-localhost}"
export GOTRUE_SMTP_PORT="${SMTP_PORT:-25}"
export GOTRUE_SMTP_USER="${SMTP_USER:-}"
export GOTRUE_SMTP_PASS="${SMTP_PASSWORD:-}"
export GOTRUE_SMTP_SENDER_NAME="${SMTP_SENDER_NAME:-Conditera}"
export GOTRUE_EXTERNAL_GOOGLE_ENABLED="${EXTERNAL_GOOGLE_ENABLED:-false}"
export GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID="${EXTERNAL_GOOGLE_CLIENT_ID:-}"
export GOTRUE_EXTERNAL_GOOGLE_SECRET="${EXTERNAL_GOOGLE_SECRET:-}"
export GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI="$API_EXTERNAL_URL/auth/v1/callback"
export GOTRUE_EXTERNAL_YANDEX_ENABLED="${EXTERNAL_YANDEX_ENABLED:-false}"
export GOTRUE_EXTERNAL_YANDEX_CLIENT_ID="${EXTERNAL_YANDEX_CLIENT_ID:-}"
export GOTRUE_EXTERNAL_YANDEX_SECRET="${EXTERNAL_YANDEX_SECRET:-}"
export GOTRUE_EXTERNAL_YANDEX_REDIRECT_URI="$API_EXTERNAL_URL/auth/v1/callback"
export GOTRUE_EXTERNAL_VK_ENABLED="${EXTERNAL_VK_ENABLED:-false}"
export GOTRUE_EXTERNAL_VK_CLIENT_ID="${EXTERNAL_VK_CLIENT_ID:-}"
export GOTRUE_EXTERNAL_VK_SECRET="${EXTERNAL_VK_SECRET:-}"
export GOTRUE_EXTERNAL_VK_REDIRECT_URI="$API_EXTERNAL_URL/auth/v1/callback"

export PGRST_DB_SCHEMAS="${PGRST_DB_SCHEMAS:-public,storage,graphql_public}"
export PGRST_DB_ANON_ROLE=anon
export PGRST_DB_USE_LEGACY_GUCS=false
export PGRST_DB_MAX_ROWS="${PGRST_DB_MAX_ROWS:-1000}"

export PG_META_DB_HOST=127.0.0.1
export PG_META_HOST=127.0.0.1
export PG_META_DB_PORT="$POSTGRES_PORT"
export PG_META_DB_NAME="$POSTGRES_DB"
export PG_META_DB_USER="$POSTGRES_USER"
export PG_META_DB_PASSWORD="$POSTGRES_PASSWORD"
export CRYPTO_KEY="$PG_META_CRYPTO_KEY"

export SERVICE_KEY="$SERVICE_ROLE_KEY"
export AUTH_JWT_SECRET="$JWT_SECRET"
export STORAGE_PUBLIC_URL="$SUPABASE_PUBLIC_URL"
export STORAGE_BACKEND=file
export FILE_STORAGE_BACKEND_PATH=/var/lib/storage
export TENANT_ID="${STORAGE_TENANT_ID:-conditera}"
export REGION="${REGION:-us-east-1}"
export GLOBAL_S3_BUCKET="${GLOBAL_S3_BUCKET:-conditera-storage}"
export POSTGREST_URL=http://127.0.0.1:3000
export PG_META_URL=http://127.0.0.1:8080
export IMGPROXY_URL=http://127.0.0.1:5001
export ENABLE_IMAGE_TRANSFORMATION=true
export REQUEST_ALLOW_X_FORWARDED_PATH=true
export FILE_SIZE_LIMIT="${FILE_SIZE_LIMIT:-52428800}"

# Imgproxy may read only the shared Storage mount, never the service rootfs.
export IMGPROXY_BIND=127.0.0.1:5001
export IMGPROXY_LOCAL_FILESYSTEM_ROOT=/var/lib/storage
export IMGPROXY_USE_ETAG=true
export IMGPROXY_AUTO_WEBP="${IMGPROXY_AUTO_WEBP:-true}"
export IMGPROXY_MAX_SRC_RESOLUTION=16.8

export KONG_DATABASE=off
# Keep Kong runtime state and its prefix logs in the writable chroot /tmp.
# The image default /usr/local/kong/logs is not writable in the extracted rootfs.
export KONG_PREFIX=/tmp/kong
export KONG_PROXY_LISTEN=0.0.0.0:8000
export KONG_ADMIN_LISTEN=127.0.0.1:8001
export KONG_DECLARATIVE_CONFIG=/var/lib/kong/kong.yml
export KONG_DNS_ORDER=LAST
export KONG_PLUGINS=bundled
export KONG_LOG_LEVEL="${KONG_LOG_LEVEL:-info}"
# Nginx runs inside chroot without a mounted /proc, so /dev/stdout and
# /dev/stderr are not reliable there. Use writable files and tail them into
# the container streams through supervisord.
export KONG_NGINX_MAIN_ERROR_LOG=/tmp/kong-error.log
export KONG_NGINX_PROXY_ACCESS_LOG=/tmp/kong-proxy-access.log
export KONG_NGINX_ADMIN_ACCESS_LOG=/tmp/kong-admin-access.log
export KONG_NGINX_PROXY_PROXY_BUFFER_SIZE=160k
export KONG_NGINX_PROXY_PROXY_BUFFERS="64 160k"
export KONG_NGINX_PROXY_PROXY_BUSY_BUFFERS_SIZE=320k

for service in postgres gotrue postgrest realtime storage meta imgproxy kong; do
  root="/opt/supabase/services/$service"
  mkdir -p "$root/dev/shm" "$root/proc" "$root/tmp" "$root/run"
  chmod 1777 "$root/tmp" "$root/dev/shm"
  for spec in "null 1 3" "zero 1 5" "random 1 8" "urandom 1 9"; do
    set -- $spec
    node="$root/dev/$1"
    if [ ! -c "$node" ]; then
      rm -f "$node"
      mknod -m 666 "$node" c "$2" "$3"
    fi
  done
  mkdir -p "$root/etc"
  for file in resolv.conf hosts hostname; do
    if [ -f "/etc/$file" ]; then
      rm -f "$root/etc/$file"
      cp "/etc/$file" "$root/etc/$file"
    fi
  done
done

# COPY from image stages normalizes ownership to root. Restore only the writable
# service directories needed by their non-root runtime users.
mkdir -p /opt/supabase/services/storage/var/lib/storage
chown 1000:1000 /opt/supabase/services/storage/var/lib/storage
chown -R 65534:65534 /opt/supabase/services/realtime/app
mkdir -p /opt/supabase/services/kong/usr/local/kong
chown -R 1001:1001 /opt/supabase/services/kong/usr/local/kong
mkdir -p /opt/supabase/services/kong/var/lib/kong
mkdir -p /opt/supabase/services/kong/tmp/kong/logs
# Nginx opens the prefix-relative error log before Kong can finish booting.
# Pre-create the file and make the complete prefix path writable by Kong UID.
touch /opt/supabase/services/kong/tmp/kong/logs/error.log
chown -R 1001:1001 /opt/supabase/services/kong/tmp/kong
chmod 0755 /opt/supabase/services/kong/tmp/kong /opt/supabase/services/kong/tmp/kong/logs
chmod 0644 /opt/supabase/services/kong/tmp/kong/logs/error.log
mkdir -p /opt/supabase/services/kong/tmp
touch /opt/supabase/services/kong/tmp/kong-error.log
touch /opt/supabase/services/kong/tmp/kong-proxy-access.log
touch /opt/supabase/services/kong/tmp/kong-admin-access.log
chmod 1777 /opt/supabase/services/kong/tmp
chown 1001:1001 /opt/supabase/services/kong/tmp/kong-error.log
chown 1001:1001 /opt/supabase/services/kong/tmp/kong-proxy-access.log
chown 1001:1001 /opt/supabase/services/kong/tmp/kong-admin-access.log
sed \
  -e "s|http://supabase-auth:9999|http://127.0.0.1:9999|g" \
  -e "s|http://supabase-rest:3000|http://127.0.0.1:3000|g" \
  -e "s|http://supabase-realtime:4000|http://127.0.0.1:4000|g" \
  -e "s|http://supabase-storage:5000|http://127.0.0.1:5000|g" \
  -e "s|http://supabase-meta:8080|http://127.0.0.1:8080|g" \
  -e "s|\${ANON_KEY}|$ANON_KEY|g" \
  -e "s|\${SERVICE_ROLE_KEY}|$SERVICE_ROLE_KEY|g" \
  /opt/supabase/kong.yml.template \
  > /opt/supabase/services/kong/var/lib/kong/kong.yml

exec /usr/bin/supervisord -n -c /etc/supervisord.conf
