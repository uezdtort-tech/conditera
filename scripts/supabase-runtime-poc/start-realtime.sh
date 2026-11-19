#!/bin/sh
set -eu
exec /usr/local/lib/supabase-runtime-poc/wait-for-postgres.sh \
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh realtime 65534:65534 \
  /usr/bin/tini -s -g -- /app/run.sh /app/bin/server
