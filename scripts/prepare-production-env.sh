#!/usr/bin/env bash
# Idempotently prepare local production env files for the PG17 single-container topology.
# Generates only application/runtime secrets. It never invents third-party provider credentials.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

command -v git >/dev/null 2>&1 || { echo "ОШИБКА: требуется Git." >&2; exit 1; }
git check-ignore -q .env.production || { echo "ОШИБКА: .env.production не защищён .gitignore." >&2; exit 1; }
git check-ignore -q .env.supabase-runtime || { echo "ОШИБКА: .env.supabase-runtime не защищён .gitignore." >&2; exit 1; }

[[ -f .env.production ]] || cp .env.production.example .env.production
[[ -f .env.supabase-runtime ]] || cp .env.supabase-runtime.example .env.supabase-runtime

python3 <<'PY'
from pathlib import Path
import base64
import hashlib
import hmac
import json
import secrets
import time

def read_lines(path):
    return Path(path).read_text(encoding="utf-8").splitlines()

def parse(lines):
    values = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values

def needs_value(value):
    return not value or "CHANGE_ME" in value or value.startswith("stub_")

def upsert(path, generated):
    lines = read_lines(path)
    seen = set()
    output = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            output.append(line)
            continue
        key, _ = line.split("=", 1)
        key = key.strip()
        seen.add(key)
        current = parse([line]).get(key, "")
        if key in generated and needs_value(current):
            output.append(f"{key}={generated[key]}")
        else:
            output.append(line)
    for key, value in generated.items():
        if key not in seen:
            output.append(f"{key}={value}")
    Path(path).write_text("\n".join(output) + "\n", encoding="utf-8")
    Path(path).chmod(0o600)
    return parse(output)

def random_hex(size):
    return secrets.token_hex(size)

app_generated = {
    "POSTGRES_PASSWORD": random_hex(32),
    "JWT_SECRET": random_hex(32),
    "JWT_REFRESH_SECRET": random_hex(32),
    "TFA_ENCRYPTION_KEY": random_hex(32),
    "CRON_SECRET": random_hex(32),
    "BOT_SECRET": random_hex(32),
    "TELEGRAM_WEBHOOK_SECRET": random_hex(32),
    "IP_HASH_SALT": random_hex(32),
    "MEILI_MASTER_KEY": random_hex(32),
    "N8N_ADMIN_PASSWORD": random_hex(32),
    "ENCRYPTOR_KEY": random_hex(32),
    "SECRET_KEY_BASE": random_hex(32),
    "SIMPLEX_BRIDGE_API_KEY": random_hex(32),
}
app = upsert(".env.production", app_generated)

def b64url(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")

def sign_jwt(role, secret):
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    now = int(time.time())
    payload = b64url(json.dumps({
        "iss": "supabase",
        "role": role,
        "iat": now,
        "exp": now + 315360000,
    }, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}"
    signature = b64url(hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest())
    return f"{signing_input}.{signature}"

jwt_generated = {
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": sign_jwt("anon", app["JWT_SECRET"]),
    "SUPABASE_SERVICE_ROLE_KEY": sign_jwt("service_role", app["JWT_SECRET"]),
}
app = upsert(".env.production", jwt_generated)

runtime_generated = {
    "APP_DATABASE_PASSWORD": random_hex(32),
    "SUPABASE_SECRET_KEY_BASE": random_hex(32),
    "PG_META_CRYPTO_KEY": random_hex(16),
    "REALTIME_DB_ENC_KEY": random_hex(8),
    "REALTIME_DB_ENC_KEY_GCM": random_hex(16),
}
runtime = upsert(".env.supabase-runtime", runtime_generated)

required_external = [
    ("SMTP_USER", app), ("SMTP_PASSWORD", app),
    ("VAPID_PUBLIC_KEY", app), ("VAPID_PRIVATE_KEY", app),
    ("YANDEX_CLIENT_ID", app), ("YANDEX_CLIENT_SECRET", app),
    ("VK_CLIENT_ID", app), ("YOOKASSA_SHOP_ID", app),
    ("YOOKASSA_SECRET_KEY", app), ("TELEGRAM_BOT_TOKEN", app),
    ("TELEGRAM_CHANNEL_ID", app),
]
missing = [key for key, values in required_external if needs_value(values.get(key, ""))]
print("Production env files prepared with generated secrets:")
print(" - .env.production (permissions 600)")
print(" - .env.supabase-runtime (permissions 600)")
print(" - Supabase anon/service_role JWTs signed with the generated JWT_SECRET")
if missing:
    print("\nStill required from the real providers (not generated):")
    for key in missing:
        print(" - " + key)
    print("\nThe deploy gate will remain closed until these values are supplied.")
else:
    print("\nAll listed third-party credential fields are present; run the deploy config gate next.")
PY

