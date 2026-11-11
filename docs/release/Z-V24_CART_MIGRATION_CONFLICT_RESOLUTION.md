# Z-V24 — CART MIGRATION CONFLICT RESOLUTION

**Дата:** 2026-11-11 · **Статус:** Z-V24 PASS (с задокументированным инцидентом защищённых путей, не связанным с предметом Z-v24) · **Режим:** диагностика → доказательство → согласованное исправление → тестирование. Публикация НЕ выполнялась.

---

## A. Executive summary

**Что было сломано.** В `supabase/migrations/` находились две миграции с одним номером 0062. Каноническая `0062_cart_sync_custom.sql` (коммит `d5489f7`, 2026-10-31) определяет актуальный контракт корзины: `custom_config jsonb` + `client_ref` + CHECK `cart_items_kind_check`. Зомби-дубликат `0062_cart_custom_items.sql` (коммит `8c3b5c6`, 2026-11-02) добавлял конкурирующую модель: колонку `metadata` и CHECK `cart_items_product_or_custom_check` (`product_id IS NOT NULL OR metadata ? 'custom'`). Живой код (`POST /api/cart`, `cart-merge.ts`, checkout) пишет **только** `custom_config` и никогда — `metadata`. Итог: при чистой установке обе миграции применялись (зомби лексикографически раньше), существующие строки проходили оба CHECK, но вставка пользовательской (custom) позиции нарушала зомби-CHECK: **SQLSTATE 23514 → HTTP 500 на POST /api/cart**.

**Почему.** Зомби-файл уже удалялся аудитом (`eabf28a`, 2026-11-04, «изоляция зомби-воскрешения из 2ad320b»), но был повторно воскрешён массовым коммитом `9e6a516` (2026-11-10, R03V-доки), который добавил 100+ файлов вместе с ранее изолированными. Это третье воскрешение в семействе инцидентов drift (№13 `371e975`, №14 `eadd7d3`, №16 `cd85b3e`, зомби-2ad320b, №Z-v24/9e6a516).

**Что сделано.** Зомби-миграция и её footgun-спутники удалены; добавлена forward-миграция `0080_cart_remove_zombie_check.sql`, чинящая существующие БД (снятие CHECK → спасение данных → условная очистка колонки); оба активных migration-runner'а (`setup.mjs`, CI `01-apply-migrations.sh`) и docker-путь `init-db.sh` защищены от класса дефекта (детекция дубликатов ID до SQL, fail-fast, честный exit code); добавлен регрессионный верификатор `scripts/verify/cart-schema-verify.mjs`; всё доказано на PostgreSQL 18.4.

**Статус:** конфликт устранён и доказан (см. I). P1 закрыт.

## B. Ground Truth (фактическое состояние на старте работ, 2026-11-11 ~12:54 UTC)

| Параметр | Фактическое значение | Результат |
|---|---|---|
| Repository path | `/home/z/my-project` | подтверждён |
| Branch | `main` | подтверждена |
| HEAD | `1ceaa4bef9c50d73a000644fec8d71a1924282a2` | совпадает с контрольной точкой Z-v23 |
| Working tree | только 4 ` D`-записи защищённых upload-путей; иных изменений нет | ИНЦИДЕНТ (см. ниже) |
| Index | 4 блоба идентичны HEAD-дереву (`ec9f8efc`, `f6c52a42`, `06b49c3c`, `cb23e5dd`), удаления НЕ staged | целостен |
| Ahead/behind | 232 ahead / 0 behind | совпадает с Z-v23 |
| Stash | пуст | OK |
| Snapshotter | внешний UUID-коммитер: `1ceaa4b` (пустой, 12:36:18), ранее amend `b35b12c` (01:47:06); в `ps` не виден; среда перезапущена ~12:51 | зафиксирован, операции завершены |
| Background Git activity | MERGE_HEAD/rebase-apply/CHERRY_PICK/BISECT отсутствуют | чисто |
| Protected paths | 4 пути в index+HEAD, **отсутствуют на диске**, skip-worktree ВЫКЛ (флаги `H`), `repair` при старте сессии не выполнялся | ИНЦИДЕНТ |
| Hooks guard | `core.hooksPath=scripts/hooks` → pre-commit → `protected-paths.sh hook-guard`, exit 0 | цел |

**Инцидент защищённых путей (drift, повторяющийся класс #13–#17+).** Все 4 защищённых upload-файла отсутствовали на диске уже на старте сессии (удалены перезапуском среды ~12:51; удаление НЕ захвачено ни одним коммитом: `1ceaa4b` пуст, HEAD-дерево содержит блобы bit-for-bit). По регламенту: инцидент зафиксирован, файлы **самостоятельно не восстанавливались**, guard не тронут. Прямое следствие: 4 теста `src/lib/redline-paths.test.ts` (guard существования путей на диске) падают — единственные 4 падения vitest, все 100% attributable к инциденту, не к Z-v24.

## C. История миграций

| Commit | Дата | Действие | Файл | Изменение схемы | Последствие |
|---|---|---|---|---|---|
| `d5489f7` | 10-31 23:35 | создание (канон) | `0062_cart_sync_custom.sql` | product_id nullable, `custom_config`, `client_ref`, `uq_cart_user_client_ref`, `kind_check`, `idx_cart_user_updated` | канонический контракт корзины |
| `8c3b5c6` | 11-02 12:50 | создание (зомби) | `0062_cart_custom_items.sql` | `metadata jsonb`, CHECK `cart_items_product_or_custom_check` | дубликат ID 0062; конфликт контрактов |
| `2ad320b` | 11-03 20:54 | UUID-snapshot | — | — | захват зомби-спутников на диске в историю |
| `eabf28a` | 11-04 18:08 | удаление (аудит) | `0062_cart_custom_items.sql` + 7 спутников | ручной откат на БД: DROP CHECK/DROP metadata | конфликт устранён (временно) |
| `9e6a516` | 11-10 13:20 | **повторное воскрешение** | `0062_cart_custom_items.sql` + спутники | — | конфликт вернулся в свежие установки |
| **Z-v24** | 11-11 | удаление зомби + `0080` | см. F | forward-repair 0080 | конфликт устранён с защитой от класса |

Зависимости последующих миграций: **никакая миграция 0063–0079 не ссылается на `cart_items`** (проверено по всем файлам) — удаление зомби ничего не ломает вниз по цепочке. Аудит-прецедент: `docs/audit/FIX_A1_A5_REPORT.md` эмпирически зафиксировал тот же регресс 2026-11-04. Причина конфликта: **дублирующий migration ID + восстановление устаревшей миграции + рассогласование с application code** (все три фактора одновременно).

## D. Воспроизведение

- **PostgreSQL:** `18.4 on x86_64-pc-linux-gnu` (embedded, порт 54329) — `SELECT version()`.
- **Чистая установка:** `DATABASE_URL=…conditera_zv24_cart_clean_zv24a bun scripts/db/setup.mjs` → exit 0, 79 файлов в леджере, **обе** 0062 применены (`0062_cart_custom_items.sql` 13:02:52.086Z, `0062_cart_sync_custom.sql` …087Z — лексикографический порядок). Ошибок SQL при установке НЕТ — конфликт проявляется только в рантайме.
- **Каталог после установки:** оба CHECK сосуществуют; колонки `metadata`, `custom_config`, `client_ref` присутствуют.
- **Сценарий (синтетические данные, изолированная БД):** пользователь + published product; вставка точно в форме payload POST /api/cart (`user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at`).
- **Результат:** R1 товарная позиция — OK; **R2 custom-позиция — `23514`, constraint `cart_items_product_or_custom_check`, таблица `cart_items`** (API отдаёт 500 «Ошибка добавления в корзину» — `src/app/api/cart/route.ts:304-323`); R3 update qty OK; R4 дубликат client_ref → 23505 (обрабатывается API); R5 delete OK; R6 строка, удовлетворяющая обоим CHECK, требует одновременного `metadata ? 'custom'` + `custom_config` — приложение такое никогда не пишет.
- **Исходная ошибка Z-v23 подтверждена**: заявленный P1 «violates check constraint при добавлении пользовательской позиции» воспроизведён независимо и точно.

## E. Стратегия исправления

Сравнение вариантов (§8 ТЗ):

| Вариант | Чистая установка | Существующие БД с зомби | История/риск | Вердикт |
|---|---|---|---|---|
| A: только удалить зомби-файл | чистая | остаются сломанными | прецедент eabf28a есть | недостаточно |
| B: править зомби-миграцию | чистая | не чинятся | нарушает воспроизводимость применённого | отклонено |
| C: только forward 0080 | оба CHECK создаются и снимаются, мусор в леджере | чинятся | безопасно, грязно | приемлемо |
| **D: A+C+спутники+раннеры** | чистая, без дубликата ID | чинятся 0080 (идемпотентно, без потерь) | удаляет footgun, чинит класс | **ВЫБРАНО** |

Критерий выбора — безопасность: D единственный закрывает fresh install, upgrade, существующие данные, последующие миграции и checkout одновременно. Git-история не переписывалась: файл удалён из рабочего дерева (прецедент `eabf28a`), леджерные записи существующих БД не тронуты.

## F. Изменения

| Файл | Действие | Назначение |
|---|---|---|
| `supabase/migrations/0062_cart_custom_items.sql` | удалён | зомби-дубликат — источник P1 |
| `supabase/migrations/0080_cart_remove_zombie_check.sql` | добавлен | forward-repair: (1) DROP CONSTRAINT IF EXISTS **до** переноса данных — порядок критичен: сам UPDATE (metadata→NULL) нарушает ещё живой зомби-CHECK (поймано и доказано на PG 18.4); (2) rescue-UPDATE: полная копия `metadata → custom_config` для экзотических строк, ничего не теряется; (3) колонка `metadata` удаляется ТОЛЬКО при 0 непустых строк, иначе NOTICE + сохранение |
| `scripts/apply-0062-cart-custom-items.ts` | удалён | footgun: повторно применял зомби-миграцию |
| `src/lib/validations/cart.ts` | удалён | мёртвая зомби-схема (0 импортов в живом коде; контракт quantity 1..99 против живого 1..999) |
| `scripts/db/setup.mjs` | изменён | детекция дубликатов ID **до** SQL (правило проекта: `NNNN_a`+`NNNN_b` = конфликт, `0016b`-стиль легален); fail-fast: после ошибки миграции fixups/demo-users/seeds не выполняются; лог причины ошибки; метка `[autocommit]` для нетранзакционных файлов |
| `supabase/init-scripts/01-apply-migrations.sh` (CI) | изменён | та же детекция дубликатов до применения |
| `scripts/init-db.sh` | изменён | `ON_ERROR_STOP=1` вместо `0`, учёт отказов, честный `exit 1` (раньше `|| true` скрывал упавшие файлы) |
| `scripts/verify/cart-schema-verify.mjs` | добавлен | регрессионный верификатор (падает на старой реализации: zомби-CHECK → 23514; проходит на исправленной) |
| `docs/audit/CONDITERA_DEFECT_REGISTER.md` | дополнен | запись D-14 |
| `docs/release/Z-V24_…` (этот файл) | добавлен | доказательная база |

Новые migration ID: **`0080_cart_remove_zombie_check.sql`** (единственный; дубликатов нет). Диагностические артефакты сессии: `agent-ctx/zv24-*.mjs|sh|sql`.

## G. Migration runner

Инвентаризация активных путей применения: `scripts/db/setup.mjs` (`db:setup`, канонический, леджер `schema_migrations`), `supabase/init-scripts/01-apply-migrations.sh` (CI `migrations-pg18`), `scripts/init-db.sh` (docker dev), строгие оконные applier'ы `ops-apply-money-path.ts`/`ops-apply-0039-0060.ts` (файл=транзакция+маркеры+exit 1 — дефектов не найдено). Подтверждённые дефекты и исправления:

| Сценарий (§11 ТЗ) | Результат |
|---|---|
| Уникальные корректные ID | PASS — полная установка 79 файлов, exit 0 |
| Дублирующий ID | **FAIL до применения SQL** (probe `0063_zv24_dup_probe.sql`: exit 1, «ДУБЛИКАТ MIGRATION ID 0063», леджер не создан) |
| SQL syntax error | non-zero exit (probe `0081_zv24_broken_probe.sql`: rc=1, файл НЕ в леджере, seeds пропущены — fail-fast) |
| Constraint violation | non-zero exit (миграционный режим `runStatements` фатален, файл откачен целиком) |
| Ошибка подключения | non-zero exit (rc=1 на мёртвом порту) |
| Уже применённая миграция | корректный skip по леджеру |
| Повторный запуск | идемпотентен: 2-й прогон «0 newly applied», exit 0 |
| Частичная ошибка | нет ложного success: exit 1, леджер чист, seeds не выполнялись |

Найденные и закрытые дефекты runner'ов: (1) отсутствие детекции дубликатов ID — оба леджер-раннера применяли обе 0062 молча; (2) `init-db.sh`: `ON_ERROR_STOP=0` + `|| true` = тихая порча; (3) `setup.mjs`: после ошибки миграции продолжались fixups/seeds (ложное «готово»); (4) текст ошибки глотался внешним catch. Нетранзакционный режим (ALTER TYPE ADD VALUE, autocommit) помечен логом `[autocommit]` и задокументирован в комментарии runner'а.

## H. Cart / Checkout

- Обычная корзина: вставка/обновление/удаление товарной позиции — OK (R1, R3, R5; verifier).
- Custom items: вставка custom-позиции после исправления — OK (R2-после; verifier).
- Смешанная корзина: обе kinds coexist; недопустимые состояния (товар+custom_config; ни того ни другого) отклонены `kind_check` — OK.
- Цены сервером: cart API цены не хранит/не принимает; checkout пересчитывает `calculateBuilderPrice` (`src/app/api/checkout/route.ts:384`); подмена клиентской цены невозможна по конструкции (price в cart_items отсутствует — проверено по схеме).
- Права доступа: все операции /api/cart по `user_id` из сессии (`getUserFromRequest`), client_ref-мутации с `.eq("user_id", …)`; vitest-набор cart-sync/cart-merge/route.test (изоляция чужой корзины) — PASS.
- Конкурентность: инвентарная конкурентность 8/8 (U-11 PASS); гонка двух POST с одним client_ref → 23505 → идемпотентный update (`route.ts:306-316`); слияние по контент-ключу MAX(quantity) — cart-merge тесты PASS.
- Idempotency: checkout-idempotency-verify — exit 0 (повторный checkout, отсутствие двойного списания).

## I. Регрессия (точные команды и коды выхода)

| # | Команда | Exit | Результат |
|---|---|---|---|
| 1 | `bun run typecheck` | 0 | OK |
| 2 | `bun run lint` | 0 | OK |
| 3 | `bun run test` (vitest) | 1 | **1552/1556**; 4 падения — `redline-paths.test.ts` (guard существования защищённых путей на диске) — 100% следствие drift-инцидента B, не Z-v24; старые тесты не удалялись и не ослаблялись |
| 4 | `bun scripts/verify/order-lifecycle-verify.mjs` | 0 | **81/81** (против dev-БД, собранной из исправленного дерева) |
| 5 | `bun scripts/verify/checkout-idempotency-verify.mjs` | 0 | PASS (synthetic cleanup подтверждён) |
| 6 | `bun scripts/verify/inventory-concurrency-verify.mjs` | 0 | **8/8**, U-11 PASS |
| 7 | `bun scripts/verify/diagnostics-verify.mjs` | 0 | **16/16** (после сброса in-memory rate-limit перезапуском dev) |
| 8 | `bun scripts/verify/ops-center-verify.mjs` | 0 | **PASS 37 / FAIL 0** |
| 9 | `bun scripts/verify/route-error-coverage.mjs` | 0 | **47/48** (исторический базлайн: 1 маршрут вне периметра) |
| 10 | `bun scripts/ops/backup-verify-restore.mjs` | 0 | **RESTORE-VERIFY: PASSED** (disposable-БД) |
| 11 | `bun scripts/verify/cart-schema-verify.mjs` (новый) | 0 | **PASS** — полный fresh-install + каталоги + поведение |
| 12 | `bash agent-ctx/zv24-runner-tests.sh` (новый) | 0 | **4/4** (дубликаты/SQL-ошибка/подключение/идемпотентность) |
| 13 | Scenario B (`agent-ctx/zv24-scenario-b.mjs`) | 0 | **18/18** — upgrade существующей БД: ремонт+данные целы+идемпотентность+no-op на pre-zombie |
| 14 | Воспроизведение R1–R6 (`agent-ctx/zv24-reproduce-cart.mjs`) | 0 | P1 подтверждён ДО фикса (23514), исчезает ПОСЛЕ (verifier) |

Ограничения: production build не запускался (история OOM среды; статус NOT VERIFIED — не влияет на локальное исправление); параллельные тяжёлые процессы не запускались (последовательно).

## J. Git integrity

- HEAD до/после работ: `1ceaa4b` (до коммита Z-v24), вся 232-коммитная локальная история сохранена; **amend/rebase/reset/cherry-pick не выполнялись** (reflog чист: единственные записи — исторические snapshot-коммиты).
- Commit создан по **явному списку файлов** (без `git add -A`); удаление зомби-файлов — рабочими `rm` + явный `git add` путей.
- Protected paths: не читались, не восстанавливались, не изменялись; index/HEAD-блобы идентичны; guard (`protected-paths.sh hook-guard`) — exit 0 до и после.
- Секретов в изменениях нет (.env/.env.local — gitignored; проверено `git check-ignore`; сайд-эффект db:setup — перезапись DATABASE_URL в .env/.env.local на последний использованный URL — задокументирован и возвращён к стандартному dev-значению).
- Случайных файлов нет: probe-миграции удалены, `supabase/migrations/` не содержит probe (проверено).

## K. Остаточные риски

- **P1 (инцидент, вне предмета Z-v24):** 4 защищённых upload-файла отсутствуют на диске (drift среды). История/index целы; восстановление — одна команда владельца (`bash scripts/protected-paths.sh repair`), но по регламенту выполняется ТОЛЬКО владельцем. До восстановления: 4 теста redline-paths падают; runtime /api/upload отсутствует в dev.
- **P2 (класс):** snapshotter среды продолжает UUID-коммиты/amend'ы — периодический риск захвата; hook-guard держит (инцидентов захвата после 441e306 нет), но skip-worktree при старте сессии не применяется (repair/skip-on не вызываются автоматически в текущей среде) — рекомендация: вызывать `protected-paths.sh repair && … skip-on` в ensure-dev при старте сессии.
- **P3:** воскрешённые спутники зомби вне скоупа корзины: `src/lib/checkout/confectioner-assignment.ts` + тест (мёртвый код, 0 импортов из живого кода) — решение владельца; `_quarantine/*` изолированы.
- **P3:** `docs/evidence/release-gate/r03-prodpath-*.json` содержат исторические упоминания 0062_cart_custom_items — evidence-артефакты прошлых прогонов, не тронуты намеренно.
- NOT VERIFIED: production build (OOM-ограничение среды); deploy/staging (запрещено ТЗ).

## L. Финальный статус

**Z-V24 PASS** — все обязательные критерии приёмки §16 доказаны:
P1 устранён (причина установлена, стратегия D, fresh PG 18.4 clean, custom item добавляется, HTTP 500 отсутствует, constraint корректен, upgrade безопасен); migration integrity (ID уникальны, runner'ы блокируют дубликаты до SQL, SQL-ошибки → non-zero, нет ложного success, повторный запуск корректен); cart integrity (обычные/custom/mixed, серверные цены, изоляция, checkout, конкурентность); regression (все наборы пройдены; 4 падения — задокументированный инцидент B, не регрессия Z-v24); git integrity (история цела, protected paths не тронуты, guard цел, секретов нет).

**Публикация не выполнялась и не разрешается этим отчётом.** HEAD на момент отчёта: `a084a4ea79ac2be2db21a2cb1999762470c0f9a1` (коммит Z-v24 поверх `1ceaa4b`), **233 ahead / 0 behind**. Для общего `PRE-PUSH APPROVED` (Z-v23) дополнительно требуются: восстановление защищённых путей владельцем (закрывает и 4 vitest-падения), решение по n8n engine/Telegram creds (A-7), YooKassa sandbox / VK / Yandex OAuth (A-4/A-5/A-6), production build вне текущей среды, повторный Z-v23 ground-truth-проход после push-решения. Далее — остановка и ожидание отдельного решения владельца.
