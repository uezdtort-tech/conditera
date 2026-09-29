#!/bin/bash
# .zscripts/build.sh — сборка проекта (deploy-пайплайн)
NEXTJS_PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$NEXTJS_PROJECT_DIR"

# OOM-фикс деплоя (см. worklog «deploy-fix-round»):
# пик `next build` этого проекта ~3GB (Turbopack + typecheck + prerender).
# Без капа V8 heap сборка убивалась OOM-killer'ом на контейнерах ~4GB
# (exit 137 → «Sorry, there was a problem deploying the code»).
# Кап 2560 проверен в песочнице: build PASS за ~1м40с.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=2560"
export NEXT_TELEMETRY_DISABLED=1
npm run build
