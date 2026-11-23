#!/usr/bin/env bash
set -Eeuo pipefail

cat >&2 <<'NOTICE'
ОТКЛОНЕНО: загрузка локальных production secrets в GitHub Actions отключена.
Текущая целевая среда — локальный Windows ПК (WSL2/Docker Desktop), а не удалённый VPS.
Храните секреты только в .env.production и .env.supabase-runtime (оба файла gitignored).
Для генерации используйте: bash scripts/prepare-production-env.sh
NOTICE
exit 78
