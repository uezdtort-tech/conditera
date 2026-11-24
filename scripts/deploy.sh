#!/usr/bin/env bash
# Безопасная блокировка старого production deploy.
#
# ВАЖНО:
# Этот сценарий намеренно ничего не запускает и не меняет.
# Историческая реализация поднимала отдельный Supabase Compose-стек,
# применяла миграции к conditera-supabase-db и могла перезапускать
# сервисы независимо от основной БД Conditera.
#
# POC одного Supabase runtime-контейнера прошёл изолированный CI smoke-test
# (см. docs/LOCAL_PC_PRODUCTION_READINESS.md), но это НЕ production cutover.
#
# Повторное включение допускается только после:
# 1. интеграции POC в фактический локальный Docker runtime владельца;
# 2. подтверждения одного Supabase runtime-контейнера на Windows/Docker Desktop;
# 3. одного PostgreSQL-кластера и одной рабочей БД;
# 4. read-only инвентаризации обеих существующих БД и Storage;
# 5. резервного копирования с проверенным восстановлением;
# 6. локальных Windows/Docker Desktop smoke, E2E и restart/recovery тестов;
# 7. отдельного подтверждения владельца проекта.
#
# Не добавлять сюда git pull, docker compose up/down, миграции,
# очистку образов/volumes или переключение DATABASE_URL до прохождения gate.

set -Eeuo pipefail

printf '%s\n' \
  'ОШИБКА: старый deploy отключён в целях защиты данных Conditera.' \
  'Supabase POC прошёл CI, но локальная production-интеграция и миграционный gate не завершены.' \
  'Скрипт не выполнял git pull, Docker-команды, миграции или изменения БД.' \
  'Сначала завершите локальный production release gate: docs/LOCAL_PC_PRODUCTION_READINESS.md'

exit 78
