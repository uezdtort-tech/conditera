# Безопасный переход Conditera на PostgreSQL 17

## Целевая архитектура

Целевая схема — единый Supabase Runtime и один логический рабочий PostgreSQL database `conditera`:

- Compose service: `supabase-runtime`;
- container: `conditera-supabase-runtime`;
- PostgreSQL major: 17;
- DB: `conditera`;
- data volume: `supabase_runtime_pg17_data`;
- Storage volume: `supabase_runtime_storage_data`.

Файл `docker-compose.supabase.yml` содержит историческую split-конфигурацию и не должен запускаться как параллельный production runtime. Целевой runtime собирается через `docker-compose.supabase-single-container.yml` и launcher `scripts/compose-single-runtime.mjs`.

## Правила миграции

- Нельзя подключать физический PG15 data directory к PG17.
- Major upgrade выполняется логическим переносом в новый PG17 cluster.
- Не удалять старые PG15 volumes до успешного restore rehearsal, проверки данных и периода наблюдения.
- Новый PG17 volume не содержит данные старого кластера автоматически: первый запуск создаёт новый кластер.
- Не выполнять `docker compose down -v`, `docker volume rm` или `docker system prune --volumes` при cutover.

## Обязательная последовательность

1. Зафиксировать окно обслуживания и остановить записи приложения.
2. Проверить фактические container/volume names через `docker inspect`.
3. Создать database + Storage backup bundle по инструкции [SUPABASE_BACKUP_RESTORE.md](operations/SUPABASE_BACKUP_RESTORE.md).
4. Скопировать bundle за пределы исходного Docker host.
5. Выполнить полный restore rehearsal на отдельном PG17 cluster.
6. Сверить миграционный ledger, таблицы и точное число строк, Auth users, profiles, роли, заказы, payments/refunds, inventory, recipes, RLS и Storage object hashes.
7. Поднять единый Runtime и проверить health, Auth, PostgREST, Storage, Realtime, OAuth, YooKassa webhook, checkout/refund, media upload/download и CMS.
8. Переключать production traffic только после успешной сверки и сохранения evidence.

## Роли, globals и внешние секреты

Database + Storage backup bundle не включает cluster globals, роли, пароли ролей и ACL/grants. Совместимые роли и расширения должны быть восстановлены контролируемым bootstrap-процессом. OAuth client secrets, SMTP credentials, DNS/TLS, YooKassa credentials и webhook configuration сохраняются отдельно в защищённом secret store; они не восстанавливаются из SQL dump.

## Откат

- Старый PG15 data volume остаётся нетронутым.
- При откате возвращается предыдущая Compose-конфигурация и PostgreSQL major, соответствующий исходному data directory.
- Нельзя запускать PG17 поверх PG15 volume даже для быстрой проверки.
- После переключения не удалять старый volume до завершения периода наблюдения и подтверждения резервной копии нового runtime.

## Статус подтверждения

Этот документ описывает безопасную процедуру. Наличие CI или новой Compose-конфигурации не доказывает, что production data уже перенесены. Cutover подтверждается только фактическим запуском PG17 на production host, restore rehearsal, сверкой данных/Storage и сохранёнными журналами выполнения.
