#!/bin/sh

# ============================================================
# start.sh — деплой-старт (Z.ai space / packaged artifact)
# ============================================================
# v2 (deploy-fix-round-2):(space-proof)
#   1. Раскладка: работает И из packaged-артефакта (start.sh лежит рядом с
#      next-service-dist/), И in-place в песочнице (из .zscripts/ — тогда
#      корень проекта на уровень выше).
#   2. Next-сервер: next-service-dist/server.js, фолбэк — .next/standalone/server.js
#      (строго валидный standalone уже проверен: HTTP 200).
#   3. Порт: перед стартом освобождаем PORT (dev-сервер песочницы держит 3000 →
#      EADDRINUSE убивал деплой; воспроизведено 2026-09-29).
#   4. БД-гигиена: отсутствие SQLite-файла больше НЕ fatal — v2.0 работает на
#      Supabase, файл нужен только как legacy-контракт артефакта; создаём через
#      bun run db:push (scripts/db-push.mjs) и продолжаем.
#   5. Caddy: best-effort с .zscripts/Caddyfile.space (минимальный :80 → 127.0.0.1:$PORT,
#      без ACME/лог-файлов/docker-апстримов — root Caddyfile рассчитан на VPS Docker
#      и в space падал). Если caddy недоступен/не смог забиндиться — это НЕ fatal:
#      главным процессом остаётся Next-сервер.
#   6. Маркер /tmp/.deploy-in-progress: dev-watchdog песочницы не перезапускает
#      dev-сервер, пока идёт деплой (иначе гонка за порт 3000).
# ============================================================

set -e

# Маркер деплоя — watchdog-гейт (TTL ~20 мин контролирует сам watchdog)
touch /tmp/.deploy-in-progress 2>/dev/null || true

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Раскладка: packaged-артефакт или in-place (.zscripts/) ---
if [ -f "$SCRIPT_DIR/next-service-dist/server.js" ]; then
    BUILD_DIR="$SCRIPT_DIR"                                  # packaged: start.sh в корне артефакта
else
    BUILD_DIR="$(dirname "$SCRIPT_DIR")"                     # in-place: .zscripts/start.sh → корень проекта
fi

# 存储所有子进程的 PID
pids=""

# 清理函数：优雅关闭所有服务
cleanup() {
    echo ""
    echo "🛑 正在关闭所有服务..."

    # 发送 SIGTERM 信号给所有子进程
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            service_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
            echo "   关闭进程 $pid ($service_name)..."
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    # 等待所有进程退出（最多等待 5 秒）
    sleep 1
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            # 如果还在运行，等待最多 4 秒
            timeout=4
            while [ $timeout -gt 0 ] && kill -0 "$pid" 2>/dev/null; do
                sleep 1
                timeout=$((timeout - 1))
            done
            # 如果仍然在运行，强制关闭
            if kill -0 "$pid" 2>/dev/null; then
                echo "   强制关闭进程 $pid..."
                kill -KILL "$pid" 2>/dev/null || true
            fi
        fi
    done

    echo "✅ 所有服务已关闭"
    exit 0
}

echo "🚀 开始启动所有服务..."
echo ""
echo "📁 BUILD_DIR=$BUILD_DIR"

# 切换到构建目录
cd "$BUILD_DIR" || exit 1

ls -lah | head -20

DEFAULT_PACKAGED_DB_PATH="/app/db/custom.db"
DEFAULT_PACKAGED_DATABASE_URL="file:$DEFAULT_PACKAGED_DB_PATH"

# 环境变量
export NODE_ENV=production
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export DATABASE_URL="${DATABASE_URL:-$DEFAULT_PACKAGED_DATABASE_URL}"

# In-place 模式：项目 .env 的 DATABASE_URL 优先（例如 песочница: file:/home/z/my-project/db/custom.db）
if [ -f "$BUILD_DIR/.env" ] && ! echo "$DATABASE_URL" | grep -q "^file:$DEFAULT_PACKAGED_DB_PATH$"; then
    ENV_DB_URL=$(grep -E '^DATABASE_URL=' "$BUILD_DIR/.env" | head -1 | cut -d= -f2- || true)
    if [ -n "$ENV_DB_URL" ]; then
        export DATABASE_URL="$ENV_DB_URL"
    fi
fi

# --- БД: мягкая гигиена (не fatal) ---
if [ "$DATABASE_URL" = "$DEFAULT_PACKAGED_DATABASE_URL" ]; then
    if [ ! -f "$DEFAULT_PACKAGED_DB_PATH" ]; then
        echo "⚠️  未找到打包后的数据库文件 $DEFAULT_PACKAGED_DB_PATH — 尝试创建（v2.0 使用 Supabase，SQLite 为 legacy 合约）"
        if command -v bun >/dev/null 2>&1; then
            (mkdir -p "$(dirname "$DEFAULT_PACKAGED_DB_PATH")" 2>/dev/null; DATABASE_URL="$DEFAULT_PACKAGED_DATABASE_URL" bun run db:push) \
                && echo "✅ legacy DB 文件已创建" \
                || echo "⚠️  无法创建 legacy DB 文件 — продолжаем（应用不使用 SQLite）"
        fi
    else
        echo "🗄️  当前使用打包数据库: $DEFAULT_PACKAGED_DB_PATH"
    fi
else
    echo "🗄️  当前使用外部指定数据库: $DATABASE_URL"
fi

# --- Next-сервер: next-service-dist → фолбэк .next/standalone ---
NEXT_SERVER=""
if [ -f "./next-service-dist/server.js" ]; then
    NEXT_SERVER="./next-service-dist/server.js"
elif [ -f "./.next/standalone/server.js" ]; then
    NEXT_SERVER="./.next/standalone/server.js"
    echo "ℹ️  next-service-dist 不存在 — 使用 .next/standalone/server.js（in-place 模式）"
    # standalone 需要 static/public на месте (standalone/.next/static + public)
    if [ ! -d "./.next/standalone/.next/static" ] && [ -d "./.next/static" ]; then
        cp -r ./.next/static "./.next/standalone/.next/static" 2>/dev/null || true
    fi
    if [ ! -d "./.next/standalone/public" ] && [ -d "./public" ]; then
        cp -r ./public "./.next/standalone/public" 2>/dev/null || true
    fi
fi

# --- Освободить порт перед стартом (dev-сервер песочницы держит 3000) ---
# fuser в контейнере отсутствует — используем lsof (проверено: /usr/bin/lsof)
free_port() {
    _port="$1"
    if command -v lsof >/dev/null 2>&1; then
        _pids=$(lsof -ti tcp:"$_port" 2>/dev/null || true)
        if [ -n "$_pids" ]; then
            echo "⚠️  端口 $_port 被占用 (PIDs: $_pids) — 释放（deploy 期间停掉 dev/旧 server）"
            kill -TERM $_pids 2>/dev/null || true
            sleep 2
            _pids=$(lsof -ti tcp:"$_port" 2>/dev/null || true)
            if [ -n "$_pids" ]; then
                kill -KILL $_pids 2>/dev/null || true
                sleep 1
            fi
        fi
    fi
}
free_port "$PORT"

if [ -n "$NEXT_SERVER" ]; then
    echo "🚀 启动 Next.js 服务器: $NEXT_SERVER"
    cd "$(dirname "$NEXT_SERVER")" || exit 1

    # 后台启动 Next.js
    bun "$(basename "$NEXT_SERVER")" &
    NEXT_PID=$!
    pids="$NEXT_PID"

    # 等待一小段时间检查进程是否成功启动
    sleep 2
    if ! kill -0 "$NEXT_PID" 2>/dev/null; then
        echo "❌ Next.js 服务器启动失败"
        exit 1
    else
        echo "✅ Next.js 服务器已启动 (PID: $NEXT_PID, Port: $PORT)"
    fi

    cd "$BUILD_DIR" || exit 1
else
    echo "❌ 未找到 Next.js 服务器文件: next-service-dist/server.js 或 .next/standalone/server.js"
fi

# 启动 mini-services（非 fatal）
if [ -f "./mini-services-start.sh" ]; then
    echo "🚀 启动 mini-services..."
    sh ./mini-services-start.sh &
    MINI_PID=$!
    pids="$pids $MINI_PID"
    sleep 1
    kill -0 "$MINI_PID" 2>/dev/null && echo "✅ mini-services 已启动 (PID: $MINI_PID)" \
        || echo "⚠️  mini-services 可能启动失败，但继续运行..."
elif [ -d "./mini-services-dist" ]; then
    echo "⚠️  未找到 mini-services 启动脚本，但目录存在"
else
    echo "ℹ️  mini-services 目录不存在，跳过"
fi

# --- Caddy（best-effort, space-safe）---
if command -v caddy >/dev/null 2>&1; then
    CADDY_CFG=""
    if [ -f "./.zscripts/Caddyfile.space" ]; then
        CADDY_CFG="./.zscripts/Caddyfile.space"
    elif [ -f "./Caddyfile.space" ]; then
        CADDY_CFG="./Caddyfile.space"
    fi
    if [ -n "$CADDY_CFG" ]; then
        echo "🚀 启动 Caddy ($CADDY_CFG, best-effort)..."
        caddy run --config "$CADDY_CFG" --adapter caddyfile &
        CADDY_PID=$!
        pids="$pids $CADDY_PID"
        sleep 1
        kill -0 "$CADDY_PID" 2>/dev/null && echo "✅ Caddy 已启动 (PID: $CADDY_PID)" \
            || echo "⚠️  Caddy 未存活 — не fatal, Next.js продолжает отвечать на :$PORT"
    else
        echo "ℹ️  space-Caddyfile 不存在 — 跳过 Caddy（Next.js 直接服务 :$PORT）"
    fi
else
    echo "ℹ️  caddy 未安装 — 跳过（Next.js 直接服务 :$PORT）"
fi

echo ""
echo "🎉 所有服务已启动！主进程: Next.js (:$PORT)"
echo ""

# --- 主进程: Next-сервер（caddy/mini-services 崩溃不影响存活）---
if [ -n "$NEXT_PID" ]; then
    # 转发信号给 Next.js
    trap 'kill -TERM "$NEXT_PID" 2>/dev/null; cleanup' INT TERM
    wait "$NEXT_PID"
else
    echo "❌ Next.js 未启动 — 无主进程"
    exit 1
fi
