#!/bin/sh
set -eu

/usr/local/lib/supabase-runtime-poc/run-chroot.sh postgres 0:0 \
  /usr/bin/pg_isready -h 127.0.0.1 -p "${POSTGRES_PORT:-5432}" \
  -U "${POSTGRES_USER:-supabase_admin}" -d "${POSTGRES_DB:-conditera}" >/dev/null

curl -fsS --max-time 3 http://127.0.0.1:9999/health >/dev/null
/usr/local/lib/supabase-runtime-poc/run-chroot.sh postgrest 1000:1000 /bin/postgrest --ready
curl -fsS --max-time 3 -H "Authorization: Bearer $ANON_KEY" \
  http://127.0.0.1:4000/api/tenants/realtime-dev/health >/dev/null
curl -fsS --max-time 3 http://127.0.0.1:5000/status >/dev/null
curl -fsS --max-time 3 -o /dev/null http://127.0.0.1:8080/health
curl -fsS --max-time 3 -H "apikey: $ANON_KEY" http://127.0.0.1:8000/auth/v1/health >/dev/null
curl -fsS --max-time 3 http://127.0.0.1:5001/health >/dev/null
test -f /run/supabase-app-migrations.done
supervisorctl -c /etc/supervisord.conf status | awk '
  $1 == "app-migrations" {
    # supervisorctl status reports EXITED + timestamp, not the process exit
    # code. The completion marker is created only after migrations and role
    # provisioning both succeed, so it is the authoritative success signal.
    if ($2 != "EXITED") bad=1
    next
  }
  $2 != "RUNNING" { bad=1 }
  END { exit bad }
'
