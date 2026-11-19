#!/bin/sh
set -eu
attempts="\${WAIT_POSTGRES_ATTEMPTS:-90}"
while [ "$attempts" -gt 0 ]; do
  if /usr/local/lib/supabase-runtime-poc/run-chroot.sh postgres 0:0 \
      /usr/local/bin/pg_isready -h 127.0.0.1 -p "\${POSTGRES_PORT:-5432}" \
      -U "\${POSTGRES_USER:-supabase_admin}" -d "\${POSTGRES_DB:-supabase}" >/dev/null 2>&1; then
    exec "$@"
  fi
  attempts=$((attempts - 1))
  sleep 2
done
echo "PostgreSQL did not become ready before timeout" >&2
exit 1
