#!/bin/bash
# .zscripts/preview.sh — preview-сервер
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
npm run preview
