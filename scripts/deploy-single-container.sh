#!/usr/bin/env bash
# Production deployment for the approved single-container Supabase + PostgreSQL 17 topology.
# This script never removes containers, volumes, database files, or Storage objects.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env.production"
RUNTIME_ENV_FILE=".env.supabase-runtime"
COMPOSE_FILES=(
  -f docker-compose.yml
  -f docker-compose.supabase.yml
  -f docker-compose.supabase-single-container.yml
)

usage() {
  cat <<'USAGE'
Использование:
  bash scripts/deploy-single-container.sh --config   Проверить env и итоговый Compose без запуска
  bash scripts/deploy-single-container.sh --up       Собрать и запустить production-стек
  bash scripts/deploy-single-container.sh --status   Показать состояние контейнеров
  bash scripts/deploy-single-container.sh --health   Проверить готовность ключевых сервисов
  bash scripts/deploy-single-container.sh --logs     Показать последние логи
  bash scripts/deploy-single-container.sh --stop     Остановить сервисы без удаления контейнеров/volumes

Запрещённые операции (down -v, удаление volumes, очистка БД/Storage) скрипт не выполняет.
USAGE
}

MODE="${1:---config}"
case "$MODE" in
  --config|--up|--status|--health|--logs|--stop) ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

compose() {
  docker compose --env-file "$ENV_FILE" --env-file "$RUNTIME_ENV_FILE" "${COMPOSE_FILES[@]}" "$@"
}

require_files() {
  for file in "$ENV_FILE" "$RUNTIME_ENV_FILE"; do
    if [[ ! -f "$file" ]]; then
      echo "ОШИБКА: отсутствует $file. Создайте его из соответствующего .example и заполните реальные значения." >&2
      exit 1
    fi
  done
  for file in docker-compose.yml docker-compose.supabase.yml docker-compose.supabase-single-container.yml Dockerfile.supabase-runtime-poc Caddyfile; do
    [[ -f "$file" ]] || { echo "ОШИБКА: отсутствует обязательный файл $file" >&2; exit 1; }
  done
}

validate_env() {
  python3 - "$ENV_FILE" "$RUNTIME_ENV_FILE" <<'PY'
import re
import sys
import time
import json
import hmac
import base64
from pathlib import Path

def read_env(path):
    values = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values

app = read_env(sys.argv[1])
runtime = read_env(sys.argv[2])
required_app = [
    "POSTGRES_PASSWORD", "JWT_SECRET", "JWT_REFRESH_SECRET", "TFA_ENCRYPTION_KEY",
    "CRON_SECRET", "BOT_SECRET", "IP_HASH_SALT", "MEILI_MASTER_KEY",
    "N8N_ADMIN_PASSWORD", "SMTP_HOST", "SMTP_PORT", "SMTP_FROM",
    "YOOKASSA_SHOP_ID", "YOOKASSA_SECRET_KEY",
    "YANDEX_CLIENT_ID", "YANDEX_CLIENT_SECRET", "VK_CLIENT_ID",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID", "TELEGRAM_WEBHOOK_SECRET",
    "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY",
    "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
]
required_runtime = [
    "APP_DATABASE_PASSWORD", "SUPABASE_SECRET_KEY_BASE", "PG_META_CRYPTO_KEY",
    "REALTIME_DB_ENC_KEY", "REALTIME_DB_ENC_KEY_GCM",
]
errors = []
for key in required_app:
    value = app.get(key, "")
    if not value:
        errors.append(f".env.production: {key} is empty or missing")
    elif "CHANGE_ME" in value or value.startswith("stub_"):
        errors.append(f".env.production: {key} still contains a placeholder")
for key in required_runtime:
    value = runtime.get(key, "")
    if not value:
        errors.append(f".env.supabase-runtime: {key} is empty or missing")
    elif "CHANGE_ME" in value or value.startswith("stub_"):
        errors.append(f".env.supabase-runtime: {key} still contains a placeholder")

for key in ("POSTGRES_PASSWORD", "JWT_SECRET", "JWT_REFRESH_SECRET", "CRON_SECRET",
            "BOT_SECRET", "MEILI_MASTER_KEY", "N8N_ADMIN_PASSWORD"):
    value = app.get(key, "")
    if value and len(value) < 32:
        errors.append(f".env.production: {key} must contain at least 32 characters")
if app.get("JWT_SECRET") == app.get("JWT_REFRESH_SECRET"):
    errors.append("JWT_REFRESH_SECRET must be different from JWT_SECRET")
tfa_key = app.get("TFA_ENCRYPTION_KEY", "")
if tfa_key and (len(tfa_key) != 64 or not re.fullmatch(r"[0-9a-fA-F]{64}", tfa_key)):
    errors.append("TFA_ENCRYPTION_KEY must be 64 hexadecimal characters")

def decode_jwt(token):
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("JWT must have three segments")
    header = json.loads(base64.urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)))
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    signature = base64.urlsafe_b64decode(parts[2] + "=" * (-len(parts[2]) % 4))
    signing_input = (parts[0] + "." + parts[1]).encode()
    expected = hmac.new(app["JWT_SECRET"].encode(), signing_input, "sha256").digest()
    if header.get("alg") != "HS256" or not hmac.compare_digest(signature, expected):
        raise ValueError("JWT signature/algorithm does not match JWT_SECRET")
    if int(payload.get("exp", 0)) <= int(time.time()):
        raise ValueError("JWT is expired")
    return payload

for key, expected_role in (("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"),
                           ("SUPABASE_SERVICE_ROLE_KEY", "service_role")):
    token = app.get(key, "")
    if token:
        try:
            payload = decode_jwt(token)
            if payload.get("role") != expected_role:
                raise ValueError(f"role must be {expected_role}")
        except Exception as error:
            errors.append(f".env.production: {key} is not a valid JWT signed by JWT_SECRET ({error})")
for key, expected in (("SUPABASE_SECRET_KEY_BASE", 64), ("PG_META_CRYPTO_KEY", 32),
                      ("REALTIME_DB_ENC_KEY", 16), ("REALTIME_DB_ENC_KEY_GCM", 32)):
    value = runtime.get(key, "")
    if value and (len(value) != expected or not re.fullmatch(r"[0-9a-fA-F]+", value)):
        errors.append(f".env.supabase-runtime: {key} must be {expected} hexadecimal characters")

if app.get("NEXT_PUBLIC_APP_URL", "").rstrip("/") != "https://conditera.ru":
    errors.append("NEXT_PUBLIC_APP_URL must be https://conditera.ru for production")
if app.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/") != "https://conditera.ru/api":
    errors.append("NEXT_PUBLIC_SUPABASE_URL must be https://conditera.ru/api")
if not app.get("YOOKASSA_SECRET_KEY", "").startswith("live_"):
    errors.append("YOOKASSA_SECRET_KEY must be a live_ production key, not a test credential")
for key in ("EXTERNAL_YANDEX_ENABLED", "EXTERNAL_VK_ENABLED"):
    if app.get(key, "").lower() != "true":
        errors.append(f".env.production: {key}=true is required to enable the requested OAuth providers")

if errors:
    print("Production environment validation failed:")
    for error in errors:
        print(" - " + error)
    sys.exit(1)
print("Production environment: required credentials and PG17 runtime secrets are present.")
PY
}

validate_compose() {
  local version
  version="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
  if [[ -z "$version" ]] || ! printf '%s\n%s\n' "2.24.0" "$version" | sort -V -C; then
    echo "ОШИБКА: требуется Docker Compose v2.24.0 или новее (используется !override)." >&2
    exit 1
  fi

  compose config --quiet
  local rendered
  rendered="$(mktemp)"
  trap 'rm -f "$rendered"' RETURN
  compose config --format json > "$rendered"
  python3 - "$rendered" <<'PY'
import json
import sys
from pathlib import Path

config = json.loads(Path(sys.argv[1]).read_text())
services = config["services"]
required = {"web", "chat-service", "redis", "meilisearch", "n8n", "caddy", "supabase-runtime"}
missing = sorted(required - services.keys())
if missing:
    raise SystemExit("Compose is missing required services: " + ", ".join(missing))

def profiles(name):
    return set(services[name].get("profiles", []))

for name in ("db", "pgbouncer", "migrator"):
    if "legacy-app-db" not in profiles(name):
        raise SystemExit(f"{name} must be disabled by legacy-app-db profile")
for name in ("supabase-db", "supabase-kong", "supabase-auth", "supabase-rest",
             "supabase-realtime", "supabase-storage", "supabase-app-migrator",
             "supabase-imgproxy", "supabase-meta", "supabase-studio",
             "supabase-analytics", "supabase-vector"):
    if "legacy-supabase" not in profiles(name):
        raise SystemExit(f"{name} must be disabled by legacy-supabase profile")

for name in ("web", "meilisearch"):
    if services[name].get("ports"):
        raise SystemExit(f"{name} must not publish host ports; Caddy is the only public web entry point")

n8n_ports = services["n8n"].get("ports", [])
if len(n8n_ports) != 1 or n8n_ports[0].get("host_ip") != "127.0.0.1" or str(n8n_ports[0].get("target")) != "5678":
    raise SystemExit("n8n must be bound to 127.0.0.1:5678 only")
caddyfile = Path("Caddyfile").read_text()
if "reverse_proxy n8n:5678" in caddyfile:
    raise SystemExit("n8n must not be reverse-proxied to the public internet")

runtime = services["supabase-runtime"]
if runtime.get("image") != "conditera/supabase-runtime:pg17":
    raise SystemExit("Supabase runtime image must be the pinned Conditera PG17 image")
if "5432" not in runtime.get("expose", []) or "8000" not in runtime.get("expose", []):
    raise SystemExit("Supabase runtime must expose PostgreSQL and Kong only on the internal Compose network")

published = services["caddy"].get("ports", [])
published_ports = {str(port.get("target")) for port in published}
if not {"80", "443"}.issubset(published_ports):
    raise SystemExit("Caddy must publish HTTP 80 and HTTPS 443")
print("Compose topology PASS: one PG17/Supabase runtime, legacy DB stacks disabled, web/search ports private.")
PY
}

health_check() {
  local failed=0
  for container in conditera-supabase-runtime conditera-web conditera-redis conditera-meilisearch conditera-chat conditera-n8n conditera-caddy; do
    local state
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)"
    printf '%-32s %s\n' "$container" "$state"
    case "$state" in healthy|running) ;;
      *) failed=1 ;;
    esac
  done
  if [[ "$failed" -ne 0 ]]; then
    echo "ОШИБКА: один или несколько production-сервисов не готовы." >&2
    return 1
  fi

  docker exec conditera-web node -e '
    (async () => {
      const urls = [
        "http://127.0.0.1:3000/api/health",
        "http://supabase-runtime:8000/auth/v1/health"
      ];
      for (const url of urls) {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(url + " returned HTTP " + response.status);
        console.log("HTTP " + response.status + " " + url);
      }
    })().catch((error) => { console.error(error); process.exit(1); });
  '
}

require_files
if [[ "$MODE" == "--status" ]]; then
  compose ps
  exit 0
fi
if [[ "$MODE" == "--logs" ]]; then
  compose logs --tail=100
  exit 0
fi
if [[ "$MODE" == "--stop" ]]; then
  compose stop web chat-service n8n caddy redis meilisearch supabase-runtime
  exit 0
fi

command -v docker >/dev/null 2>&1 || { echo "ОШИБКА: Docker CLI не найден." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ОШИБКА: Docker Desktop/daemon не запущен." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ОШИБКА: требуется Python 3 для проверки конфигурации." >&2; exit 1; }
if [[ "$MODE" == "--health" ]]; then
  health_check
  exit $?
fi
validate_env
validate_compose

if [[ "$MODE" == "--config" ]]; then
  echo "Конфигурация проверена. Контейнеры и volumes не изменялись."
  exit 0
fi

echo "Остановка только legacy-контейнеров БД/Supabase без удаления их volumes..."
compose stop db pgbouncer migrator supabase-db supabase-kong supabase-auth supabase-rest \
  supabase-realtime supabase-storage supabase-app-migrator supabase-imgproxy \
  supabase-meta supabase-studio supabase-analytics supabase-vector || true

echo "Сборка и запуск единого Supabase runtime (PostgreSQL 17) и приложения..."
compose up -d --build supabase-runtime redis meilisearch web chat-service n8n caddy

echo "Ожидание readiness (до 10 минут)..."
for attempt in $(seq 1 60); do
  if health_check >/dev/null 2>&1; then
    health_check
    echo "Production services are healthy. No volumes were removed."
    exit 0
  fi
  sleep 10
done

echo "ОШИБКА: сервисы не прошли readiness за 10 минут. Последние логи:" >&2
compose ps >&2 || true
compose logs --tail=150 supabase-runtime web chat-service caddy >&2 || true
exit 1
