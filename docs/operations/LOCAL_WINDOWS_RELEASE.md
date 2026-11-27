# Локальный выпуск Conditera на Windows

Целевой production-хост проекта — Windows-ПК владельца. Исторический GitHub workflow для VPS намеренно заблокирован и не используется.

## Предварительные условия

- Windows 11 и Docker Desktop запущен (Linux containers).
- Git for Windows (Git Bash), Docker Compose plugin и Python 3 доступны в PATH.
- В корне репозитория подготовлены .env.production, .env.supabase-runtime и .secrets/n8n_encryption_key. Секреты не помещать в Git и не передавать в CI.
- Ветка и SHA выпуска предварительно сверены с принятым PR/релизным кандидатом.

## Проверка без изменения контейнеров

Из PowerShell в корне C:\Conditera.ru:

```powershell
.\scripts\deploy-single-container.ps1 -Mode Config
.\scripts\deploy-single-container.ps1 -Mode Health
.\scripts\deploy-single-container.ps1 -Mode Status
```

Проверка Config валидирует секреты, Compose topology, единый Supabase runtime и PostgreSQL 17; она не запускает и не останавливает контейнеры.

## Запуск

Mode Up запускает backup/rollout процедуру из Bash-скрипта. До её запуска нужно отдельно проверить наличие и пригодность резервной копии и сверить источник данных. Скрипт не удаляет Docker volumes и не выполняет compose down -v.

```powershell
# Только если старые БД проверены и их данные действительно не нужны:
.\scripts\deploy-single-container.ps1 -Mode Up -ConfirmEmptyLegacyDatabases
```

## Ограничения

- Wrapper не создаёт и не угадывает production-секреты.
- Он не переключает DNS, OAuth credentials или YooKassa.
- Успешный запуск контейнеров не равен полной приёмке сайта.
- Если найдены прежние PostgreSQL-контейнеры, release по умолчанию останавливается после создания архивов: контейнеры и volumes не трогаются. Переход на пустую PG17 БД разрешается только явным параметром -ConfirmEmptyLegacyDatabases после проверки, что старые данные не нужны. Архивирование не является восстановлением.
- Для остановки без удаления данных: -Mode Stop. Никогда не использовать docker compose down -v.