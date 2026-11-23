#!/bin/sh
set -eu
exec /usr/local/lib/supabase-runtime-poc/run-chroot.sh imgproxy 999:999 \
  /usr/local/bin/entrypoint.sh imgproxy
