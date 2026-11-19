#!/bin/sh
set -eu

root="${SUPABASE_RUNTIME_ROOT:-/opt/supabase/services}/postgres"
pgdata="${PGDATA:-/var/lib/postgresql/data}"

# Resolve the image's own postgres account instead of assuming a numeric UID.
postgres_uid="$(chroot "$root" /usr/bin/id -u postgres)"
postgres_gid="$(chroot "$root" /usr/bin/id -g postgres)"

# A fresh Docker volume is root-owned. Correct only the mount root; existing
# database files retain their original ownership and are not recursively changed.
chroot "$root" /usr/bin/chown "$postgres_uid:$postgres_gid" "$pgdata"

# Run the official entrypoint as postgres. This deliberately bypasses gosu,
# which requires /proc/self/exe and cannot work in an unmounted chroot /proc.
exec chroot --userspec="$postgres_uid:$postgres_gid" "$root" \
  /usr/local/bin/docker-entrypoint.sh postgres -D "$pgdata" \
  -c config_file=/etc/postgresql/postgresql.conf \
  -c dynamic_shared_memory_type=mmap
