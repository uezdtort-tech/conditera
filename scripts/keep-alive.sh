#!/bin/bash
# scripts/keep-alive.sh — health-check loop
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
while true; do
  curl -s http://localhost:3000/api/health > /dev/null 2>&1
  sleep 30
done
