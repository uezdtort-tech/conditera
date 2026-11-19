#!/bin/sh
set -eu
exec /usr/local/lib/supabase-runtime-poc/wait-for-postgres.sh \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:3000/ \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:8080/health \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:5001/health \
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh storage 1000:1000 \
  /bin/sh -c 'cd /app && exec /usr/local/bin/node dist/start/server.js'
