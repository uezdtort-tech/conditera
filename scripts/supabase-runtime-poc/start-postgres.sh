#!/bin/sh
set -eu
exec /usr/local/lib/supabase-runtime-poc/run-chroot.sh postgres 0:0 \
  /usr/local/bin/docker-entrypoint.sh postgres -D /etc/postgresql \
  -c dynamic_shared_memory_type=mmap
