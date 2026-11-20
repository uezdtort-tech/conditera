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
export DENO_DIR=/root/.cache/deno
export JWT_SECRET
export VERIFY_JWT=true
export SUPABASE_URL=http://127.0.0.1:8000
export SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}"
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export PORT=9000

# Edge Runtime stays in the same container and listens only on its internal
# loopback port; Kong is the only gateway exposed to the Compose network.
exec chroot "$root" /usr/local/bin/edge-runtime start \
  --main-service /home/deno/functions/main \
  --user-worker-request-idle-timeout 150000
