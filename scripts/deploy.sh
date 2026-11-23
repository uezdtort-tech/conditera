#!/usr/bin/env bash
# Безопасная блокировка исторического production deploy.
#
# Этот legacy-скрипт намеренно ничего не запускает и не меняет.
# Он относился к прежней multi-container/dual-database архитектуре и не
# является точкой входа для согласованного production runtime.
#
# Актуальная целевая архитектура:
# - один Supabase runtime контейнер;
# - единая чистая PostgreSQL 17.12;
# - новый постоянный volume, SEED_MODE=none;
# - локальный Windows ПК владельца с Docker Desktop/WSL2;
# - запуск через scripts/deploy-single-container.sh после прохождения gate.
#
# Владелец подтвердил, что все прежние БД пустые: перенос или слияние
# пользовательских данных не требуется. Не добавлять в этот скрипт
# backup/restore старых БД, переключение двух кластеров или миграцию PGDATA.
#
# Не добавлять сюда git pull, docker compose up/down, миграции,
# очистку образов/volumes или переключение DATABASE_URL.
# Для целевой среды используйте docs/LOCAL_PC_PRODUCTION_READINESS.md
# и docs/PRODUCTION_DB_CUTOVER_GATE.md.

set -Eeuo pipefail

printf '%s\n' \
  'ОШИБКА: исторический deploy отключён и не является production entrypoint Conditera.' \
  'Целевая среда — локальный Windows ПК владельца, единый Supabase runtime и PostgreSQL 17.12.' \
  'Используйте scripts/deploy-single-container.sh после прохождения актуального release gate.' \
  'Этот скрипт не выполнял git pull, Docker-команды, миграции или изменения БД.'

exit 78
