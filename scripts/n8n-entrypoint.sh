#!/bin/sh
# Import and activate only workflows explicitly approved in source control.
set -eu

IMPORT_DIR="${N8N_WORKFLOWS_DIR:-/imports}"
USER_DIR="${N8N_USER_FOLDER:-/home/node/.n8n}"
PORT="${N8N_PORT:-5678}"
MARKER="$USER_DIR/.conditera-workflows.sha256"
IDS_MARKER="$USER_DIR/.conditera-workflow-ids"

mkdir -p "$USER_DIR"

# n8n Server CLI requires an initialized database. Initialize a fresh SQLite
# volume once, then stop the temporary server before importing workflows.
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
  import_dir="$(mktemp -d)"
  current_ids="$(mktemp)"
  trap 'rm -rf "$import_dir"; rm -f "$current_ids"' EXIT INT TERM

  workflow_hash="$(node - "$IMPORT_DIR" "$import_dir" "$current_ids" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sourceDir = process.argv[2];
const importDir = process.argv[3];
const idsFile = process.argv[4];
const files = fs.readdirSync(sourceDir).filter((name) => name.endsWith('.json')).sort();
const hash = crypto.createHash('sha256');
const active = [];
for (const name of files) {
  const fullPath = path.join(sourceDir, name);
  const workflow = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (workflow.active !== true) continue;
  if (!workflow.id) throw new Error(name + ': active workflow must have a stable id');
  const content = fs.readFileSync(fullPath);
  hash.update(name);
  hash.update('\0');
  hash.update(content);
  hash.update('\0');
  fs.copyFileSync(fullPath, path.join(importDir, name));
  active.push(workflow.id);
}
fs.writeFileSync(idsFile, active.join('\n') + (active.length ? '\n' : ''));
process.stdout.write(hash.digest('hex'));
NODE
)"

  if [ ! -s "$MARKER" ] || [ "$(cat "$MARKER")" != "$workflow_hash" ]; then
    has_active_workflows=false
    for workflow_file in "$import_dir"/*.json; do
      if [ -f "$workflow_file" ]; then has_active_workflows=true; break; fi
    done
    if [ "$has_active_workflows" = "true" ]; then
      echo "[n8n-bootstrap] importing verified active workflows"
      n8n import:workflow --separate --input="$import_dir"
    fi
  else
    echo "[n8n-bootstrap] verified workflow source unchanged; import skipped"
  fi

  while IFS= read -r workflow_id; do
    [ -n "$workflow_id" ] || continue
    n8n update:workflow --id="$workflow_id" --active=true
  done < "$current_ids"

  # If a workflow was removed or disabled in source control, deactivate its
  # previously imported copy. Never delete workflows or execution history.
  if [ -s "$IDS_MARKER" ]; then
    while IFS= read -r old_id; do
      [ -n "$old_id" ] || continue
      if ! grep -Fqx "$old_id" "$current_ids"; then
        n8n update:workflow --id="$old_id" --active=false || \
          echo "[n8n-bootstrap] stale workflow $old_id is already absent; skipping"
      fi
    done < "$IDS_MARKER"
  fi

  cp "$current_ids" "$IDS_MARKER.tmp"
  mv "$IDS_MARKER.tmp" "$IDS_MARKER"
  printf '%s\n' "$workflow_hash" > "$MARKER.tmp"
  mv "$MARKER.tmp" "$MARKER"
  rm -rf "$import_dir"
  rm -f "$current_ids"
  trap - EXIT INT TERM
fi

exec n8n start
