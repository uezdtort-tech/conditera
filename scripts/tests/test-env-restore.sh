#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/existing.env" <<'ENV'
JWT_SECRET=existing-jwt-secret-keep-this
DATABASE_URL=postgresql://user:pass@localhost/db?sslmode=require&application_name=Conditera
CUSTOM_VALUE=pipe|ampersand&backslash\\value
EMPTY_VALUE=
# COMMENTED_SECRET=must-not-be-restored
ENV

cat > "$TMP_DIR/template.env" <<'ENV'
JWT_SECRET=CHANGE_ME
DATABASE_URL=CHANGE_ME
EMPTY_VALUE=template-default
NEXT_PUBLIC_APP_URL=https://conditera.ru
ENV

bash "$ROOT/scripts/restore-env-values.sh" "$TMP_DIR/existing.env" "$TMP_DIR/template.env"

grep -Fxq 'JWT_SECRET=existing-jwt-secret-keep-this' "$TMP_DIR/template.env"
grep -Fxq 'DATABASE_URL=postgresql://user:pass@localhost/db?sslmode=require&application_name=Conditera' "$TMP_DIR/template.env"
grep -Fxq 'CUSTOM_VALUE=pipe|ampersand&backslash\\value' "$TMP_DIR/template.env"
grep -Fxq 'EMPTY_VALUE=template-default' "$TMP_DIR/template.env"
grep -Fxq 'NEXT_PUBLIC_APP_URL=https://conditera.ru' "$TMP_DIR/template.env"
! grep -q 'COMMENTED_SECRET' "$TMP_DIR/template.env"

echo "setup-env preservation test: PASS"
