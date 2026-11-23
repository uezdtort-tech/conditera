#!/bin/sh
# Deterministic, repository-controlled n8n workflow import and activation.
set -eu

IMPORT_DIR="${N8N_WORKFLOWS_DIR:-/imports}"
USER_DIR="${N8N_USER_FOLDER:-/home/node/.n8n}"
PORT="${N8N_PORT:-5678}"
MARKER="$USER_DIR/.conditera-workflows.sha256"
IDS_MARKER="$USER_DIR/.conditera-workflow-ids"

mkdir -p "$USER_DIR"

# The Server CLI needs an initialized n8n database. On a fresh SQLite volume,
# briefly start n8n so it creates/migrates the DB, then stop it before import.
if [ "${DB_TYPE:-sqlite}" = "sqlite" ] && [ ! -s "$USER_DIR/database.sqlite" ]; then
  echo "[n8n-bootstrap] initializing empty n8n database"
  n8n start >/tmp/conditera-n8n-bootstrap.log 2>&1 &
  bootstrap_pid=$!
  ready=0
  attempt=0
  while [ "$attempt" -lt 90 ]; do
    if wget -q -O /dev/null "http://127.0.0.1:$PORT/healthz"; then
      ready=1
      break
    fi
    if ! kill -0 "$bootstrap_pid" 2>/dev/null; then
      cat /tmp/conditera-n8n-bootstrap.log >&2 || true
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  if [ "$ready" -ne 1 ]; then
    kill -TERM "$bootstrap_pid" 2>/dev/null || true
    wait "$bootstrap_pid" 2>/dev/null || true
    cat /tmp/conditera-n8n-bootstrap.log >&2 || true
    echo "[n8n-bootstrap] database initialization timed out" >&2
    exit 1
  fi
  kill -TERM "$bootstrap_pid" 2>/dev/null || true
  wait "$bootstrap_pid" 2>/dev/null || true
fi

if [ -d "$IMPORT_DIR" ]; then
  workflow_hash="$(node - "$IMPORT_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
const hash = crypto.createHash('sha256');
for (const name of files) {
  const content = fs.readFileSync(path.join(dir, name));
  hash.update(name);
  hash.update('\0');
  hash.update(content);
  hash.update('\0');
}
process.stdout.write(hash.digest('hex'));
NODE
)"

  if [ ! -s "$MARKER" ] || [ "$(cat "$MARKER")" != "$workflow_hash" ]; then
    echo "[n8n-bootstrap] importing source-controlled workflows"
    n8n import:workflow --separate --input="$IMPORT_DIR"
  else
    echo "[n8n-bootstrap] workflow source unchanged; import skipped"
  fi

  current_ids="$(mktemp)"
  for file in "$IMPORT_DIR"/*.json; do
    [ -f "$file" ] || continue
    workflow_id="$(node -e 'const w=require(process.argv[1]); process.stdout.write(String(w.id || ""))' "$file")"
    active="$(node -e 'const w=require(process.argv[1]); process.stdout.write(w.active === true ? "true" : "false")' "$file")"
    [ -n "$workflow_id" ] || {
      echo "[n8n-bootstrap] workflow file has no stable id: $file" >&2
      rm -f "$current_ids"
      exit 1
    }
    printf '%s\n' "$workflow_id" >> "$current_ids"
    if [ "$active" = "true" ]; then
      n8n update:workflow --id="$workflow_id" --active=true
    else
      n8n update:workflow --id="$workflow_id" --active=false
    fi
  done

  # Workflows removed from the repository are deactivated, never deleted.
  if [ -s "$IDS_MARKER" ]; then
    while IFS= read -r old_id; do
      [ -n "$old_id" ] || continue
      if ! grep -Fqx "$old_id" "$current_ids"; then
        n8n update:workflow --id="$old_id" --active=false || {
          echo "[n8n-bootstrap] unable to deactivate removed workflow $old_id" >&2
          rm -f "$current_ids"
          exit 1
        }
      fi
    done < "$IDS_MARKER"
  fi

  cp "$current_ids" "$IDS_MARKER.tmp"
  mv "$IDS_MARKER.tmp" "$IDS_MARKER"
  printf '%s\n' "$workflow_hash" > "$MARKER.tmp"
  mv "$MARKER.tmp" "$MARKER"
  rm -f "$current_ids"
fi

exec n8n start
