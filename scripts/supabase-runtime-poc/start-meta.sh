#!/bin/sh
set -eu
exec /usr/local/lib/supabase-runtime-poc/wait-for-postgres.sh \
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh meta 1000:1000 \
  /bin/sh -c 'cd /app && exec /usr/local/bin/node dist/server/server.js'
