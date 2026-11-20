#!/bin/sh
set -eu
exec /usr/local/lib/supabase-runtime-poc/wait-for-postgres.sh \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:9999/health \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:3000/ \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:4000/ \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:5000/status \
  /usr/local/lib/supabase-runtime-poc/wait-for-http.sh http://127.0.0.1:8080/health \
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh kong 1001:1001 \
  /docker-entrypoint.sh kong docker-start
