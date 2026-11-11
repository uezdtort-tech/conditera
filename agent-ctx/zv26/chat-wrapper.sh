#!/bin/bash
# Z-v26: wrapper-цикл для chat-server (персистентность в песочнице, подход Z-v25-F5)
cd /home/z/my-project/mini-services/chat-server
while true; do
  bun run index.ts >> /home/z/my-project/agent-ctx/zv26/chat-server.log 2>&1
  echo "$(date '+%H:%M:%S') chat-server exited, restarting in 2s" >> /home/z/my-project/agent-ctx/zv26/chat-server.log
  sleep 2
done
