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

# Kong API keys are JWT/base64url strings. Restrict characters so sed replacement
# cannot reinterpret a key as a replacement expression.
case "$ANON_KEY_VALUE" in
  *[!A-Za-z0-9._-]*) fail "SUPABASE_ANON_KEY contains unsupported characters" ;;
esac
case "$SERVICE_KEY_VALUE" in
  *[!A-Za-z0-9._-]*) fail "SUPABASE_SERVICE_KEY contains unsupported characters" ;;
esac

umask 077
sed \
  -e "s|\${SUPABASE_ANON_KEY}|$ANON_KEY_VALUE|g" \
  -e "s|\${SUPABASE_SERVICE_KEY}|$SERVICE_KEY_VALUE|g" \
  "$TEMPLATE" > "$RENDERED"

if grep -Fq '${SUPABASE_ANON_KEY}' "$RENDERED" || grep -Fq '${SUPABASE_SERVICE_KEY}' "$RENDERED"; then
  rm -f "$RENDERED"
  fail "unresolved API-key placeholders remain in rendered Kong config"
fi

chmod 600 "$RENDERED"
export KONG_DECLARATIVE_CONFIG="$RENDERED"

if [ "${KONG_RENDER_ONLY:-false}" = "true" ]; then
  echo "$RENDERED"
  exit 0
fi

exec /docker-entrypoint.sh kong docker-start
