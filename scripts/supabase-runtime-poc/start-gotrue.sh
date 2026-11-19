#!/bin/sh
set -eu
exec /usr/local/lib/supabase-runtime-poc/wait-for-postgres.sh \
  /usr/local/lib/supabase-runtime-poc/run-chroot.sh gotrue 1000:1000 \
  /usr/local/bin/gotrue auth
