#!/bin/sh
set -eu
url="$1"
shift
attempts="${WAIT_HTTP_ATTEMPTS:-90}"
while [ "$attempts" -gt 0 ]; do
  code="$(curl --connect-timeout 2 --max-time 3 -sS -o /dev/null -w '%{http_code}' "$url" || true)"
  if [ "$code" != "000" ] && [ -n "$code" ]; then
    exec "$@"
  fi
  attempts=$((attempts - 1))
  sleep 2
done
echo "HTTP dependency did not become reachable: $url" >&2
exit 1
