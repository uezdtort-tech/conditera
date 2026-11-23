#!/bin/sh
set -eu
exec /usr/local/lib/supabase-runtime-poc/wait-for-postgres.sh \
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh postgrest 1000:1000 \
  /bin/postgrest
