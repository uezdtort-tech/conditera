#!/bin/bash
# ====================================================================
# scripts/setup-cloudflare-tunnel.sh — Настройка стабильного Cloudflare Tunnel
# ====================================================================
# Решает проблему "разрывы каждые 3-4 минуты" через:
#   1. Установка протокола http2 вместо quic
#   2. Настройка reconnect-session с grace-period
#   3. Запуск как systemd-сервис с автоперезапуском
#   4. Мониторинг через metrics endpoint
#
# Запуск (на сервере, где работает cloudflared):
#   sudo ./scripts/setup-cloudflare-tunnel.sh <tunnel-id>
#
# После установки:
#   sudo systemctl status cloudflared
#   sudo journalctl -u cloudflared -f
# ====================================================================

set -e

TUNNEL_ID="${1:-}"
if [ -z "$TUNNEL_ID" ]; then
  echo "Использование: $0 <tunnel-id>"
  echo ""
  echo "Получить tunnel-id:"
  echo "  cloudflared tunnel list"
  echo "  # или создать новый:"
  echo "  cloudflared tunnel create conditera2"
  exit 1
fi

echo "=== Настройка Cloudflare Tunnel: $TUNNEL_ID ==="

# 1. Проверяем, что cloudflared установлен
if ! command -v cloudflared &> /dev/null; then
  echo "❌ cloudflared не установлен"
  echo "Установка:"
  echo "  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb"
  echo "  sudo dpkg -i cloudflared.deb"
  exit 1
fi

# 2. Проверяем, что пользователь залогинен
if [ ! -f ~/.cloudflared/cert.pem ]; then
  echo "❌ Не залогинены. Запустите: cloudflared tunnel login"
  exit 1
fi

# 3. Создаём директорию конфига
mkdir -p ~/.cloudflared
CONFIG_FILE=~/.cloudflared/config.yml

# 4. Проверяем credentials
if [ ! -f ~/.cloudflared/$TUNNEL_ID.json ]; then
  echo "❌ Файл credentials не найден: ~/.cloudflared/$TUNNEL_ID.json"
  echo "Создайте туннель: cloudflared tunnel create $TUNNEL_ID"
  exit 1
fi

# 5. Генерируем config.yml с http2 протоколом (стабильнее quic)
cat > $CONFIG_FILE << EOF
# Сгенерировано scripts/setup-cloudflare-tunnel.sh
# Дата: $(date -Iseconds)

tunnel: $TUNNEL_ID
credentials-file: /root/.cloudflared/$TUNNEL_ID.json

# Протокол http2 — стабильнее чем quic (решает разрывы каждые 3-4 минуты)
protocol: http2

# Автоматическое переподключение
reconnect-session: true
grace-period: 30s
retention: 30m

# Логи
loglevel: info
transport-loglevel: warn
metrics: 0.0.0.0:36500

# Origin requests — таймауты к Caddy
origin-request:
  connect-timeout: 10s
  tls-timeout: 10s
  tcp-keepalive: 30s
  keep-alive-timeout: 90s
  http2-origin: true
  no-happy-eyeballs: true

ingress:
  - hostname: conditera.ru
    service: http://localhost:80
    originRequest:
      connectTimeout: 10s
      noTLSVerify: true
      http2Origin: true
  - hostname: www.conditera.ru
    service: http://localhost:80
    originRequest:
      connectTimeout: 10s
      noTLSVerify: true
  - service: http_status:404
EOF

echo "✓ Config written to $CONFIG_FILE"

# 6. Настраиваем DNS
echo ""
echo "Настройка DNS..."
cloudflared tunnel route dns $TUNNEL_ID conditera.ru 2>&1 || echo "  (DNS уже настроен)"
cloudflared tunnel route dns $TUNNEL_ID www.conditera.ru 2>&1 || echo "  (www DNS уже настроен)"

# 7. Устанавливаем как systemd-сервис
echo ""
echo "Установка systemd-сервиса..."
sudo tee /etc/systemd/system/cloudflared.service > /dev/null << EOF
[Unit]
Description=Cloudflare Tunnel (conditera2)
After=network-online.target
Wants=network-online.target

[Service]
TimeoutStartSec=0
Type=notify
ExecStart=/usr/local/bin/cloudflared --config /root/.cloudflared/config.yml tunnel run
Restart=on-failure
RestartSec=5s
# Если cloudflared падает 5 раз за минуту — останавливаемся
StartLimitBurst=5
StartLimitIntervalSec=60

# Безопасность
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=/root/.cloudflared
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# 8. Активируем и запускаем
sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared

echo ""
echo "=== Готово ==="
echo ""
echo "Проверка статуса:"
echo "  sudo systemctl status cloudflared"
echo ""
echo "Логи:"
echo "  sudo journalctl -u cloudflared -f"
echo ""
echo "Метрики (для Prometheus):"
echo "  curl http://localhost:36500/metrics"
echo ""
echo "Если разрывы продолжаются, проверьте:"
echo "  1. Брандмауэр: sudo ufw status"
echo "  2. MTU: ping -s 1472 -M do cloudflare.com"
echo "  3. DNS: dig conditera.ru"
echo "  4. Интернет: mtr -T cloudflare.com (TCP traceroute)"
