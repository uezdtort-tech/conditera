#!/bin/sh
set -eu

root="${SUPABASE_RUNTIME_ROOT:-/opt/supabase/services}/postgres"
pgdata="${PGDATA:-/var/lib/postgresql/data}"

# Read the image's account database from the extracted rootfs. Do not assume
# that the minimal PostgreSQL image contains coreutils' id/chown utilities.
passwd_file="$root/etc/passwd"
postgres_entry="$(awk -F: '$1 == "postgres" { print $3 ":" $4; exit }' "$passwd_file")"
if [ -z "$postgres_entry" ]; then
  echo "postgres account is missing from $passwd_file" >&2
  exit 1
fi

# Docker mounts a fresh named volume over PGDATA. Fix only the mount root;
# never recursively rewrite ownership of an existing database directory.
chown "$postgres_entry" "$root$pgdata"

# Run the official image entrypoint as postgres. Bypass gosu, whose
# /proc/self/exe dependency is unavailable in this chroot runtime.
exec chroot --userspec="$postgres_entry" "$root" \
  /usr/local/bin/docker-entrypoint.sh postgres -D "$pgdata" \
  -c config_file=/etc/postgresql/postgresql.conf \
  -c dynamic_shared_memory_type=mmap
