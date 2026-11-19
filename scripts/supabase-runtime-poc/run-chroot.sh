#!/bin/sh
set -eu
service="$1"
user="$2"
shift 2
root="${SUPABASE_RUNTIME_ROOT:-/opt/supabase/services}/$service"
exec chroot --userspec="$user" "$root" "$@"
