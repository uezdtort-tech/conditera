#!/bin/bash
# .zscripts/mini-services-build.sh — сборка mini-services
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/mini-services"
cd "$ROOT_DIR"
for svc in chat-server simplex-bridge; do
  if [ -d "$svc" ]; then
    echo "→ Building $svc..."
    cd "$svc"
    npm install --production
    cd "$ROOT_DIR"
  fi
done
