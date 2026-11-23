#!/bin/sh
set -eu
kong_root="${SUPABASE_RUNTIME_ROOT:-/opt/supabase/services}/kong"
if ! grep -q '^kong:' "$kong_root/etc/passwd"; then
  echo "Kong account is missing from $kong_root/etc/passwd" >&2
  exit 1
fi
exec /usr/local/lib/supabase-runtime-poc/wait-for-postgres.sh \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:9999/health \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:3000/ \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:4000/ \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:5000/status \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:8080/health \
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh kong "0:0" \
  /docker-entrypoint.sh kong docker-start
