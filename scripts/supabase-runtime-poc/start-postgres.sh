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

# Reproduce the environment declared by the official Supabase Postgres image.
# The Dockerfile copies the image rootfs, not its image-level ENV metadata.
export POSTGRES_HOST="${POSTGRES_HOST:-/var/run/postgresql}"
if [ -f "$root/nix/var/nix/profiles/default/lib/locale/locale-archive" ]; then
  export LANG="${LANG:-en_US.UTF-8}"
  export LANGUAGE="${LANGUAGE:-en_US:en}"
  export LC_ALL="${LC_ALL:-en_US.UTF-8}"
  export LOCALE_ARCHIVE="${LOCALE_ARCHIVE:-/nix/var/nix/profiles/default/lib/locale/locale-archive}"
  export POSTGRES_INITDB_ARGS="${POSTGRES_INITDB_ARGS:---allow-group-access --locale-provider=icu --encoding=UTF-8 --icu-locale=en_US.UTF-8}"
else
  # Safe fallback for an image without the Nix locale archive.
  export LANG=C LANGUAGE=C LC_ALL=C
  export POSTGRES_INITDB_ARGS="${POSTGRES_INITDB_ARGS:---encoding=UTF8 --lc-collate=C --lc-ctype=C}"
  config_file="$root/etc/postgresql/postgresql.conf"
  if grep -q 'en_US.UTF-8' "$config_file"; then
    sed -i 's/en_US.UTF-8/C/g' "$config_file"
  fi
fi

# The upstream entrypoint uses Bash process substitution for initdb's
# --pwfile. A chroot without a mounted /proc cannot resolve /dev/fd/N.
# Patch only that exact upstream construct to use a short-lived file in the
# container's writable rootfs (not in the persistent PGDATA volume).
if [ ! -s "$root$pgdata/PG_VERSION" ]; then
  if grep -q -- '--pwfile=<(printf' "$entrypoint"; then
    sed -i 's|--pwfile=<(printf .*"$POSTGRES_PASSWORD")|--pwfile=/tmp/initdb-password|' "$entrypoint"
    sed -i '/^[[:space:]]*docker_init_database_dir$/a\    rm -f /tmp/initdb-password' "$entrypoint"
  fi

  if ! grep -q -- '--pwfile=/tmp/initdb-password' "$entrypoint" ||
     ! grep -q 'rm -f /tmp/initdb-password' "$entrypoint"; then
    echo "PostgreSQL entrypoint does not match the supported initdb pwfile contract" >&2
    exit 1
  fi

  password_file="$root/tmp/initdb-password"
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
  -c "cron.database_name=$POSTGRES_DB" \
  -c "cron.username=$POSTGRES_USER" \
  -c dynamic_shared_memory_type=mmap
