#!/usr/bin/env bash
# Cross-platform canonical validator lives in env-check.mjs.
# This wrapper is retained for deploy scripts and Linux operators.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"
exec node "$SCRIPT_DIR/env-check.mjs" "${1:-dev}" "${2:-}"
