#!/bin/bash
# .zscripts/build.sh — сборка проекта
NEXTJS_PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$NEXTJS_PROJECT_DIR"
npm run build
