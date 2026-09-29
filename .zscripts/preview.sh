#!/bin/bash
# .zscripts/preview.sh — preview-сервер
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
# OOM-фикс: `next build` этого проекта пикует ~3GB — кап обязателен (см. worklog «deploy-fix-round»)
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=2560"
export NEXT_TELEMETRY_DISABLED=1
npm run preview
