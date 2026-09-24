#!/bin/bash
# .zscripts/mini-services-install.sh — установка зависимостей mini-services
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/mini-services"
cd "$ROOT_DIR"
for svc in chat-server simplex-bridge; do
  if [ -d "$svc" ]; then
    echo "→ Installing $svc..."
    cd "$svc"
    npm install
    cd "$ROOT_DIR"
  fi
done
