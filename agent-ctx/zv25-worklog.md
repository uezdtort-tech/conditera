# Z-v25 — Рабочий журнал (прогрессия, фиксируется по мере выполнения)

## Этап 1 — Ground Truth (ЗАВЕРШЁН)

Дата: 2026-11-11 (UTC), среда выполнения: /home/z/my-project

| # | Параметр | Факт |
|---|----------|------|
| 1 | Директория | /home/z/my-project |
| 2 | Репозиторий | uezdtort-tech/conditera |
| 3 | Ветка | main |
| 4 | HEAD | 3c10708ac1533f5fbf897c56cbf4da0fe9a80d36 (2026-11-11 13:54:37 +0000) |
| 5 | Последние 20 коммитов | получены (a084a4e — фикс Z-v24; 394e241/b126f6a/3c10708 после него) |
| 6 | Родители | линейная история: 3c10708←b126f6a←394e241←a084a4e←1ceaa4b←b35b12c… |
| 7 | Рабочее дерево | ЧИСТОЕ (0 записей porcelain) |
| 8 | Индекс | без изменений |
| 9 | Незакоммиченные | нет |
| 10 | Stash | пуст |
| 11 | Ahead/behind (без fetch) | 0 behind / **236 ahead** origin/main |
| 12 | 4 защищённых файла | ВСЕ существуют, статус clean |
| 13 | Git-флаги защищённых | H (skip-worktree выключен; защита = pre-commit hook-guard) |
| 14 | Hooks | core.hooksPath=scripts/hooks; pre-commit → scripts/protected-paths.sh hook-guard |
| 15 | protected-paths.sh | существует (3803 байт, scripts/protected-paths.sh — НЕ scripts/hooks/ как в ТЗ) |
| 16 | Snapshotter | АКТИВНЫХ процессов нет; UUID-коммиты b126f6a/1ceaa4b/2f52a55 ПУСТЫЕ (проверено git show --stat) |
| 17 | Процессы | dev-server (3000), embedded PG 18.4 (54329), bun mini-services — штатные |

### 1.1 История Z-v24
- `a084a4e` существует: удалил зомби `0062_cart_custom_items.sql`, добавил `0080_cart_remove_zombie_check.sql`, удалил apply-0062-скрипт и src/lib/validations/cart.ts (0 импортов), харденинг setup.mjs + init-db.sh + CI 01-apply-migrations.sh
- После Z-v24: только 394e241 (docs), b126f6a (UUID, ПУСТОЙ — проверено фактически), 3c10708 (docs+worklog, 3 файла). Изменений миграций/кода НЕТ.
- Отклонение от ТЗ (INFO): путь guard фактически scripts/protected-paths.sh; skip-worktree выключен (управляется режимами skip-on/skip-off), защита живёт на pre-commit hook-guard. Блобы защищённых файлов MATCH индексу и HEAD (hash-object = ls-files -s). Стоп-условий §14 нет.

### Env
PostgreSQL 18.4 (embedded, 54329), Node v24.22.2, bun 1.3.14; RAM 3.9Gi (avail ~1.5Gi), swap 0, диск 6.0G free.

## Этап 2 — Независимая проверка Z-v24 (ЗАВЕРШЁН)

### 2.1 Ответы на 14 вопросов о миграциях — все YES/PASS
1. Зомби удалён из дерева: ДА (только 0062_cart_sync_custom.sql)
2. Второй файл с тем же ID: НЕТ (uniq -d пуст, 79 файлов)
3. Скрытые ссылки на metadata: НЕТ (grep по cart-коду пуст)
4. Код, ожидающий metadata: НЕТ (0 импортов validations/cart; route.ts/checkout пишут custom_config)
5. DROP зомби-CHECK до переноса данных: ДА (0080 строки 20-21 до DO-блока; эмпирически доказано сценарием B2-order: UPDATE при живом CHECK → 23514)
6. Потери при rescue: НЕТ (B2: полный перенос metadata→custom_config, 2/2 строки целы)
7. NULL: корректно (UPDATE WHERE metadata IS NOT NULL; товарная строка с NULL metadata не тронута)
8. Условный DROP COLUMN: ДА (B1: колонка СОХРАНЕНА при данных; B2: удалена при пустоте)
9. Обычные товары: не затронуты (UPDATE только product_id IS NULL; B1/B2/B3 товарные строки целы)
10. RLS/ownership: не нарушены (0080 не трогает политики; cart_items: RLS on, 4 owner-only политики)
11. Идемпотентна: ДА (B3: двойное применение; B1-rerun: штатный повторный setup exit 0)
12. Частичное выполнение: невозможно через setup.mjs (транзакция на файл); psql-путь (init-db.sh/CI) — идемпотентные шаги + честный exit 1
13. Повторный запуск: безопасен (C2, B1-rerun, B3)
14. Леджер после ошибки: честен (C1: exit 1, леджер чист, откат, fail-fast без сидов)

### 2.2 Migration runner (11 требований)
- setup.mjs: ДА по всем пунктам, эмпирически C1/C2/C3 + B1-rerun (детерминированный natural sort; транзакция на файл; ALTER TYPE ADD VALUE — autocommit с комментарием)
- **ДЕФЕКТ (находка Z-v25-F2, P2): scripts/apply-migrations.ts — fake-success**: не-идемпотентная ошибка → только warn, в конце всегда «✅ All migrations applied successfully!», exit 0. Эмпирически доказано (C4: 1 ok, 1 failed → exit 0). НЕ подключён: нет в package.json/CI/док-командах (упомянут только в подсказках ошибок verify-money-path.ts и apply-seed-staging.sh). Риск — ручной запуск разработчиком.
- init-db.sh: ON_ERROR_STOP=1, FAILED_MIGRATIONS → exit 1 (Z-v24). Дубликаты ID НЕ проверяет заранее (но ошибка приведёт к честному падению ON_ERROR_STOP). Docker-путь.
- CI 01-apply-migrations.sh: дубликаты ДО SQL, леджер, ON_ERROR_STOP=1, exit 1, seeds только на fresh. Используется в Dockerfile/docker-compose*/ci.yml (migrations-pg18).
- Параллельный запуск: advisory lock ОТСУТСТВУЕТ (INFO/P3-риск, локальная разработка)

### 2.3 Независимое воспроизведение (disposable PG 18.4)
- Сценарий A (чистая установка, БД conditera_zv25_a_clean, штатный setup.mjs, exit 0): **18/18 PASS** (1 ложный FAIL из-за regex моего скрипта — pg_get_constraintdef добавляет скобки; исправлен скрипт, схема корректна). 248 таблиц, 356 функций, 67 триггеров, ledger 79/79.
- Сценарий B (легаси-обновление): **24/24 PASS**. B1 (леджер до-0080 + артефакты зомби + данные → ШТАТНЫЙ setup.mjs): custom-вставка до фикса 23514 зомби-CHECK; upgrade exit 0; зомби удалён, kind_check сохранён, metadata сохранена при данных; данные целы; custom после фикса OK; rerun идемпотентен. B2 (rescue-путь): UPDATE до DROP CHECK → 23514 (порядок критичен — доказано); 0080: rescue полный, metadata удалена, NULL-строки не тронуты. B3: 0080 no-op на чистой схеме, двойное применение.
- Сценарий C (сбои): **6/6 PASS**. C1: SQL-ошибка → exit 1, леджер чист, откат, fail-fast (сиды пропущены намеренно). C2: повторный прогон после устранения → exit 0. C3: дубликат ID 0063 → заблокирован ДО SQL, ledger пуст. C4: legacy apply-migrations.ts fake-success ПОДТВЕРЖДЁН.
- Примечание: probe-файлы (9999/0063) создавались и удалялись в рамках теста; дерево чистое до и после.

### 2.4 HTTP и бизнес-сценарии корзины (реальный API :3000)
- HTTP cart: **28/31 PASS** (agent-ctx/zv25/http-cart-scenarios.mjs). Все 3 FAIL — каскад от acceptance-gate в checkout (см. ниже); корзина: пустая → product inserted → custom inserted (P1-регресс: было 500/23514 — исправлено) → 2-й custom → dedup merged MAX(2,5)=5 → повторный POST updated → PATCH qty → изменение custom-конфига → некорректный productType 422 → неизвестная начинка 422 → qty=0 400 → несуществующий товар 400 → 401 без токена → 403 fail-closed CSRF → изоляция чужой корзины (404 PATCH/DELETE, строка A цела) → 8 параллельных POST без дублей → PUT merge.
- Rate limiting: register 3/час сработал честно на повторных прогонах (fail-closed подтверждён).
- CSRF: double-submit cookie (GET /api/csrf-token + x-csrf-token), мутации без токена → 403 (корректный fail-closed).
- Checkout (agent-ctx/zv25/checkout-scenarios.mjs): **9/10 PASS + 1 ложный FAIL скрипта (custom-снимок хранится плоско в selected_attributes — подтверждено прямым запросом; фактически 10/10)**. Заказ UK-2026-275910: total 22940 = 18500×1 + 2220×2 (серверный расчёт конструктора), идемпотентность по Idempotency-Key (тот же id, 1 запись в БД), payment/create stub 200 (isStub).
- Acceptance-gate (P0.5 §29) работает fail-closed: блокирует checkout при RECIPE_MISSING / MISSING_PRODUCT_DATA / LOW_STOCK / PURCHASE_ETA_MISSING.
- **НАХОДКА Z-v25-F1 (P1 data-readiness, owner action)**: на рабочих демо-данных НИ ОДИН из 12 published-товаров не проходит acceptance-gate (1 имеет рецепт, но без production_time; 3 имеют production_time, но без рецепта → RECIPE_MISSING; у остальных нет ни того, ни другого). Checkout товарных позиций заблокирован для всех товаров до конфигурации данных. Дефект НЕ кодовый — данные/конфигурация для запуска.
- Для проверки работоспособности были добавлены обратимые синтетические данные (inventory «Ягоды» 1000г supplier=ZV25-synthetic + production_time_hours=6 демо-товару) — ПОСЛЕ теста восстановлены (удалено/NULL, проверено rowCount=1/1). Синтетические заказы zv25 (UK-2026-275910 + идемпотент) оставлены (удаление нарушило бы финансовый леджер; маркированы как синтетика пользователя zv25-http-a-*).

Артефакты: agent-ctx/zv25/{scenario-a-verify.mjs, scenario-b-verify.mjs, scenario-c-runner-tests.sh, http-cart-scenarios.mjs, checkout-scenarios.mjs, scenario-a-setup.log, c1-c4.log}
