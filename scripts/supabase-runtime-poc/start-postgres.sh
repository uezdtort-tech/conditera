#!/bin/sh
set -eu

root="${SUPABASE_RUNTIME_ROOT:-/opt/supabase/services}/postgres"
pgdata="${PGDATA:-/var/lib/postgresql/data}"
entrypoint="$root/usr/local/bin/docker-entrypoint.sh"

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

# The upstream entrypoint uses Bash process substitution for initdb's
# --pwfile. A chroot without a mounted /proc cannot resolve /dev/fd/N.
# Patch only that exact upstream construct to use a short-lived file in the
# container's writable rootfs (not in the persistent PGDATA volume).
if [ ! -s "$root$pgdata/PG_VERSION" ]; then
  if grep -q -- '--pwfile=<(printf' "$entrypoint"; then
    sed -i 's|--pwfile=<(printf .*"$POSTGRES_PASSWORD")|--pwfile=/run/initdb-password|' "$entrypoint"
    sed -i '/^[[:space:]]*docker_init_database_dir$/a\    rm -f /run/initdb-password' "$entrypoint"
  fi

  if ! grep -q -- '--pwfile=/run/initdb-password' "$entrypoint" ||
     ! grep -q 'rm -f /run/initdb-password' "$entrypoint"; then
    echo "PostgreSQL entrypoint does not match the supported initdb pwfile contract" >&2
    exit 1
  fi

  password_file="$root/run/initdb-password"
  umask 077
  printf '%s\n' "$POSTGRES_PASSWORD" > "$password_file"
  chown "$postgres_entry" "$password_file"
  chmod 600 "$password_file"
fi

# Run the official image entrypoint as postgres. Bypass gosu, whose
# /proc/self/exe dependency is unavailable in this chroot runtime.
exec chroot --userspec="$postgres_entry" "$root" \
  /usr/local/bin/docker-entrypoint.sh postgres -D "$pgdata" \
  -c config_file=/etc/postgresql/postgresql.conf \
  -c dynamic_shared_memory_type=mmap
