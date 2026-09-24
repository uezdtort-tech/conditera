#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$PROJECT_DIR/mini-services/chat-server"
ENV_FILE="$PROJECT_DIR/.env"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}💬 Запуск Socket.IO чат-сервера${NC}\n"

if [ ! -f "$SERVER_DIR/index.ts" ]; then
  echo -e "${RED}❌ Не найден: $SERVER_DIR/index.ts${NC}"
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

export CHAT_PORT="${CHAT_PORT:-3030}"

echo -e "${GREEN}✅ Порт: $CHAT_PORT${NC}"
echo -e "${YELLOW}🚀 Запуск...${NC}\n"

cd "$SERVER_DIR"
exec bun --hot index.ts
