#!/bin/bash
# scripts/start-network.sh — запуск docker-сети
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
docker-compose -f docker-compose.yml up -d
