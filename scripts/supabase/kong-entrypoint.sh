#!/bin/sh
set -eu

TEMPLATE="${KONG_DECLARATIVE_CONFIG:-/var/lib/kong/kong.yml}"
RENDERED="${KONG_RENDERED_CONFIG_PATH:-/tmp/conditera-kong-rendered.yml}"
ANON_KEY_VALUE="${SUPABASE_ANON_KEY:-}"
SERVICE_KEY_VALUE="${SUPABASE_SERVICE_KEY:-}"

fail() {
  echo "conditera-kong-entrypoint: $*" >&2
  exit 1
}

[ -r "$TEMPLATE" ] || fail "declarative template is not readable: $TEMPLATE"
[ -n "$ANON_KEY_VALUE" ] || fail "SUPABASE_ANON_KEY is required"
[ -n "$SERVICE_KEY_VALUE" ] || fail "SUPABASE_SERVICE_KEY is required"

is_placeholder_key() {
  case "$1" in
    CHANGE_ME*|change_me*|stub[-_]*|fallback-*|dev-*|dev_*|placeholder*|example*|dummy*|test[-_]*)
      return 0
      ;;
  esac
  return 1
}
if is_placeholder_key "$ANON_KEY_VALUE" || is_placeholder_key "$SERVICE_KEY_VALUE"; then
  fail "placeholder/test API keys are forbidden in the Kong runtime"
fi

case "$ANON_KEY_VALUE" in
  *[!A-Za-z0-9._-]*) fail "SUPABASE_ANON_KEY contains unsupported characters" ;;
esac
case "$SERVICE_KEY_VALUE" in
  *[!A-Za-z0-9._-]*) fail "SUPABASE_SERVICE_KEY contains unsupported characters" ;;
esac

umask 027
sed \
  -e "s|\${SUPABASE_ANON_KEY}|$ANON_KEY_VALUE|g" \
  -e "s|\${SUPABASE_SERVICE_KEY}|$SERVICE_KEY_VALUE|g" \
  "$TEMPLATE" > "$RENDERED"

if grep -Fq '${SUPABASE_ANON_KEY}' "$RENDERED" || grep -Fq '${SUPABASE_SERVICE_KEY}' "$RENDERED"; then
  rm -f "$RENDERED"
  fail "unresolved API-key placeholders remain in rendered Kong config"
fi

# The Docker image starts as root and drops privileges to the kong user.
# Transfer ownership before Kong reads the rendered file.
if id kong >/dev/null 2>&1; then
  chown kong:kong "$RENDERED" || { rm -f "$RENDERED"; fail "cannot assign rendered config to kong user"; }
else
  rm -f "$RENDERED"
  fail "kong runtime user does not exist in the image"
fi
chmod 640 "$RENDERED"
export KONG_DECLARATIVE_CONFIG="$RENDERED"

if [ "${KONG_RENDER_ONLY:-false}" = "true" ]; then
  echo "$RENDERED"
  exit 0
fi

exec /docker-entrypoint.sh kong docker-start
