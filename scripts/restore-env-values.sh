#!/usr/bin/env bash
# Восстановить существующие непустые значения env-файла после копирования нового шаблона.
# Использование: bash scripts/restore-env-values.sh <старый-файл> <новый-файл>
set -euo pipefail

SOURCE_FILE="${1:?Укажите исходный env-файл}"
TARGET_FILE="${2:?Укажите целевой env-файл}"

if [ ! -f "$SOURCE_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
  echo "Source and target env files must exist." >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue

  key="${BASH_REMATCH[2]}"
  value="${BASH_REMATCH[3]}"
  value="${value%$'\r'}"
  [ -n "$value" ] || continue

  # Экранируем символы sed replacement; сами значения не выводим в stdout.
  escaped_value=$(printf '%s' "$value" | sed -e 's/[\\&|]/\\&/g')
  if grep -qE "^$key=" "$TARGET_FILE"; then
    sed -i.bak "s|^$key=.*|$key=$escaped_value|" "$TARGET_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$TARGET_FILE"
  fi
done < "$SOURCE_FILE"

rm -f "${TARGET_FILE}.bak"
