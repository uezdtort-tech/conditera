# PRODUCT_OPERATING_SYSTEM — операционная система продукта (Z-v31)

**Статус:** действующий процесс. **Маркер сессии:** Z-v31. **Иерархия:** по вопросам ПРОЦЕССА этот документ главный; детализация реализации — в профильных документах (`ERROR_TRACKING.md`, `MONITORING.md`, `INCIDENT_MANAGEMENT.md`, `ROLLBACK_RUNBOOK.md`, `BACKUP_RECOVERY.md`, `CI_CD.md`).

Назначение — управляемое завершение продукта: конечный цикл «ошибка → инцидент → задача → исправление → проверка → релиз», а не бесконечные аудиты. Новые находки не оформляются новыми аудит-файлами — они попадают в единый реестр `docs/operations/PRODUCT_BACKLOG.md`.

---

## 1. Назначение и объём

- Этот документ описывает, как оператор/агент обязан работать с ошибками, проверками, коммитами и релизами в рабочем дереве.
- Объём: жизненный цикл ошибки (регистрация → классификация → статусная модель → исправление → верификация), уровни регрессионных проверок, правила локальной работы и коммитов, локальный release gate, откат, бэкапы, поведение при недоступной БД, ограничения автоматизации, известные долги.
- Что НЕ входит: детали реализации канала диагностики (см. `ERROR_TRACKING.md`), метрики/расписания мониторинга (см. `MONITORING.md`), серверные runbook'и деплоя (см. `PRODUCTION_RELEASE.md`, `STAGING_DEPLOYMENT.md`).
- Правило честности сквозное: результат проверки считается «PASS» только при exit code 0; всё, что не выполнено или не могло быть выполнено, помечается `FAIL` / `NOT RUN` / `NOT VERIFIED` — молчаливых пропусков и фиктивных PASS не бывает.

## 2. Архитектура регистрации ошибок (как есть, DEPLOY-01)

Исходники: `src/lib/diagnostics/{event-store,capture,client-report,masking,fingerprint,global-handlers}.ts`, `src/instrumentation.ts`, `src/lib/http-helpers.ts`, `src/proxy.ts`. Детали — `ERROR_TRACKING.md` §3.1–3.8.

**Канал (event-store.ts), константы кода:**

| Механизм | Значение |
|---|---|
| Очередь событий | 500, drop-oldest (`totalDropped++`) |
| Батч-запись | 300 мс; таймаут записи 3000 мс |
| Circuit-breaker | 5 подряд неудач → канал открыт 30 с (события только в консоль) |
| Per-fingerprint rate limit | 20 событий / 60 с (факт ошибки всё равно агрегируется в инцидент) |
| Режим | fire-and-forget; сбой диагностики никогда не влияет на бизнес-код |

**Маскирование (masking.ts):** 35 ключевых паттернов `SENSITIVE_KEY_PATTERNS` (значение → `[REDACTED]`) + 7 значимых паттернов `SENSITIVE_VALUE_PATTERNS` (JWT, Bearer, sk_/pk_live/test, пароль в URL, карты, inline base64, service-role ключи). PII (email/телефон/ИНН/СНИЛС) — на ключевом уровне. Переписки/содержимое файлов не сохраняются даже фрагментом (REDACT-целое). Маскирование выполняется ДО записи в БД; лимиты: строка 512, metadata 4000, stack 8000 симв.

**Fingerprint (fingerprint.ts):** sha-256, первые 40 hex, от `component|errorCode|normalizedMessage|route`; нормализация вырезает UUID/hex-хэши/большие числа. Одна логическая ошибка = один fingerprint = один инцидент.

**Врезки:** `handleRouteError` (API-роуты; HttpError <500 — info без записи, ≥500 — `error`, прочие — `unhandled_route_error`), `captureServerError` (cron/чат/фоновые), `captureDependencyError` (infrastructure/warning). Клиент: `reportClientError` → `POST /api/diagnostics/client-errors` (keepalive, payload ≤16KB, стек с клиента не передаётся и не принимается — только флаг `hasStack`; ingest: 202, rate limit 20/мин/IP → 429, size-guard → 413, `component` принудительно `frontend`, severity только `error|warning`). Страховочный слой: `instrumentation.ts register()` → `process.on("uncaughtException"/"unhandledRejection")` → severity `critical`; в production после uncaughtException — flush и exit(1) (управление `DIAGNOSTICS_EXIT_ON_UNCAUGHT`).

**Корреляция:** `src/proxy.ts` генерирует/пробрасывает `x-request-id`, событие ↔ запрос ↔ лог сопоставляются по одному id.

**Хранилище** (миграция `supabase/migrations/0079_diagnostics_incidents.sql`): `app_error_events` (raw-события, retention 90 дней по умолчанию, cleanup через `/api/cron/diagnostics-cleanup`), `app_incidents` (реестр, не удаляется автоматически), `app_incident_history` (переходы). RLS — admin-only, клиентских INSERT/DELETE-политик нет (fail-closed), запись только сервером через pg-пул.

**API админа:** `GET /api/admin/diagnostics/incidents` (+ история/переходы через PATCH), `GET /api/admin/diagnostics/metrics`, `GET /api/admin/diagnostics/events`; доступ `requireAnyRole(["ADMIN","SUPER_ADMIN"])` → 401/403.

**Приватность:** секреты и PII маскируются до записи; stack trace сохраняется только для серверных событий; клиентский стек не принимается вовсе.

## 3. Уровни критичности и приоритеты

Severity события — `debug|info|warning|error|critical` (CHECK-ограничение в БД). Приоритет инцидента — `P0|P1|P2|P3`, выставляется автоматически `classifyPriority()` (event-store.ts) на каждое событие и служит ПОДСКАЗКОЙ, не истиной: человек может переклассифицировать при триаже.

| Уровень по ТЗ | Выражение в системе (severity + priority) |
|---|---|
| CRITICAL | severity `critical`; P0 для `payments`/`database`/`infrastructure`, иначе P1 |
| HIGH | severity `error`; P1 для `payments`/`auth`/`orders`, иначе P2 |
| MEDIUM | severity `warning` (или `error` вне критичных компонентов); P2 |
| LOW | severity `info`; P3 |
| INFO | severity `debug`/`info`; P3 |

Практический смысл:

- **P0/P1** — Telegram-уведомление с дедупликацией (`notifyCriticalIncidentDeduped`, at-least-once, отметка `notified_at`); если канал не настроен — честный `console.warn` раз в минуту, уведомление не отправляется. Реагирование — по `INCIDENT_MANAGEMENT.md` §4.4.
- **P2** — в реестр, план на текущую итерацию; **P3** — реестр, фоновый порядок.
- Авто-исправление CRITICAL/HIGH без назначенного человека ЗАПРЕЩЕНО (§12).

## 4. Статусная модель инцидентов

Основная линия: `NEW → TRIAGED → IN_PROGRESS → FIXED → VERIFIED → CLOSED`. Статус `INVESTIGATING` из требований соответствует фактическому статусу `IN_PROGRESS`.

Полная карта переходов (`TRANSITIONS`, `src/lib/diagnostics/incidents.ts`; нарушение — HTTP 409 `IncidentStateError`):

| Из | Допустимые переходы |
|---|---|
| NEW | TRIAGED, IN_PROGRESS, IGNORED, CLOSED |
| TRIAGED | IN_PROGRESS, IGNORED, CLOSED |
| IN_PROGRESS | FIXED, IGNORED, CLOSED |
| FIXED | VERIFIED, CLOSED |
| VERIFIED | CLOSED, REOPENED |
| CLOSED | REOPENED |
| REOPENED | TRIAGED, IN_PROGRESS, FIXED, IGNORED, CLOSED |
| IGNORED | REOPENED |

- **REOPENED (авто):** SQL в `upsertIncident` (event-store.ts) при повторе fingerprint делает `status = CASE WHEN status IN ('CLOSED','VERIFIED') THEN 'REOPENED'`. Примечание: в фактическом SQL-условии статус `FIXED` НЕ присутствует — рецидив при FIXED остаётся FIXED (растёт `occurrence_count`). Если ожидание «REOPENED после FIXED тоже» — требует проверки владельцем; пока приоритет у поведения кода.
- **IGNORED** — только с обязательной непустой причиной (`ignore_reason`); без причины переход отклоняется (400). Автор (`ignore_actor_id`) и время фиксируются.
- **История переходов** — `app_incident_history`: `from_status`, `to_status`, `actor_id` (+ имя из `profiles`), `note`, `created_at`; читается админ-API, пишется `transitionIncident`.
- При переходах FIXED/VERIFIED/CLOSED фиксируются `resolved_at`, `resolved_version` (= `APP_VERSION`), `fix_commit` (COALESCE — повторный переход не затирает существующий).
- Сводка по статусам/приоритетам — `getIncidentSummary()` (`openTotal` = NEW+TRIAGED+IN_PROGRESS+REOPENED).

## 5. Регрессионные проверки — три уровня

**Целевая модель процесса:**

1. **Быстрый уровень — после каждого изменения:** `bun run check:quick` — tsc + ESLint по изменённым файлам + целевые vitest-файлы затронутых модулей.
2. **Затронутый блок:** `bunx vitest run <files>` — полный прогон тестов изменённых модулей.
3. **Полный релизный гейт — перед публикацией:** `bun run check:full` — tsc + `eslint .` + весь vitest + `node scripts/verify/route-error-coverage.mjs` (гвард единой регистрации ошибок; эталонный прогон 47/48, exit 0 — Z-v19, 2026-11-10).

**Фиксация результатов:** прогоны пишутся в `docs/operations/checks/latest.json` + `docs/operations/checks/history/` (с commit SHA и временем); падения — в `docs/operations/checks/failures/<fingerprint>.json`, откуда `scripts/regression/register-failure.mjs` регистрирует их в `app_error_events`/`app_incidents` как обычные события (fail-open: если БД недоступна, pending-файл падения остаётся на диске и ретраится позже — факт падения не теряется).

**Правило честности:** проверка считается пройденной только при exit code 0. Таймаут, пропуск, «не собралось» = FAIL/NOT RUN, но не PASS.

**Статус реализации (честно):** каркас создан (Z31-3-a, проверено чтением рабочего дерева): в `package.json` зарегистрированы скрипты `check:quick` и `check:full`; созданы `scripts/regression/run-checks.mjs` (CLI `--mode=quick|full`; пишет `docs/operations/checks/latest.json` + `history/`, падения — `failures/<fingerprint>.json` с best-effort регистрацией), `scripts/regression/lib/meta.mjs`, `scripts/regression/register-failure.mjs` (bun; `storeErrorEvent` из `@/lib/diagnostics/event-store`; fail-open), тест `src/lib/regression/meta.test.ts`, `docs/operations/checks/history/.gitkeep`, `docs/operations/checks/failures/.gitkeep`. e2e-прогон выполнен 2026-11-12: check:quick exit 0 (PASS), check:full exit 1 — единственный FAIL vitest = redline-guard по 4 удалённым защищённым upload-файлам (корректное срабатывание защиты, конфликт зафиксирован как ZV31-016); регистрация падения в БД подтверждена (registered_at выставлен, повтор после поднятия embedded PG), инцидент виден в админ-панели «Инциденты» (P2/NEW/infrastructure); PASS⇔exit 0 подтверждена в обоих режимах. Выходные JSON присутствуют в `docs/operations/checks/` (latest.json + history/ + failures/). Правило честности сохраняется: PASS ⇔ exit 0; всё не выполненное — NOT RUN, не PASS.

## 6. Порядок исправления ошибок (§8 ТЗ)

1. **Обнаружение:** событие попадает в `app_error_events` автоматически (§2); человек — через админ-API/метрики/уведомления P0/P1.
2. **Запись:** факт ошибки фиксируется системой; ручная фиксация — через тот же канал (не «в столбик в чате»).
3. **Группировка:** по fingerprint — один инцидент на логическую ошибку (`occurrence_count`, `first/last_seen_at`, `first/last_version`).
4. **Классификация:** авто-приоритет `classifyPriority` + подтверждение человека; severity/приоритет корректируются при триаже (NEW → TRIAGED).
5. **Задача:** находка переносится в единый реестр `PRODUCT_BACKLOG.md` (или `ops_tasks` для серверных задач); новые аудит-файлы не создаются.
6. **Исправление:** пакетом связанных ошибок (одна причина — несколько fingerprint), а не по одному хотфиксу.
7. **Целевые проверки:** уровень (а)+(б) из §5 — только затронутые компоненты. Полный аудит после каждой правки НЕ запускается; полный гейт §5(в) — по расписанию релиза (§8).
8. **Привязка фикс-коммита:** `fix_commit` записывается через `PATCH /api/admin/diagnostics/incidents` (переход FIXED, поле `fix_commit`); один SHA может закрывать пакет инцидентов.
9. **VERIFIED — только после успешной проверки** (§5б на исправленном коде; для релизных рисков — после гейта §8). Затем CLOSED. Рецидив → REOPENED (§4).

Автоматическое исправление CRITICAL/HIGH без назначенного ответственного ЗАПРЕЩЕНО (§12).

## 7. Процесс локальных обновлений и коммитов

- **Разрешено:** локальное редактирование кода/доков, запуск тестов и гвардов, локальные коммиты — завершёнными логическими пакетами (один пакет = одна смысловая правка + её проверки).
- **Push — только отдельным согласованным этапом публикации.** Запрещено: push в рамках обычной работы; staging/production deploy из рабочей сессии; миграции реальных БД; `git reset --hard`; `git clean -fd`; массовый `git add -A`; переписывание истории (rebase/amend опубликованных SHA).
- **Защищённые upload-файлы** (`MANDATORY_PATHS` в `scripts/protected-paths.sh`, 4 пути): `src/app/api/upload/route.ts`, `src/app/api/upload/route.test.ts`, `src/app/api/services/upload/route.ts`, `src/app/api/services/upload/route.test.ts` — не читать, не менять, не коммитить (в т.ч. удаления). Защита трёхслойная: repair (восстановление), skip-worktree, pre-commit hook-guard (`scripts/hooks/pre-commit`) — **не обходить**.
- **При конфликте защиты** (hook сработал, файл «восстановлен», ожидания не совпали): остановиться, зафиксировать путь и причину в worklog/backlog; не бороться с гвардом повторными операциями.

## 8. Release gate (локальная подготовка публикации)

| # | Пункт | Действие | Критерий |
|---|---|---|---|
| 1 | Полный гейт | `bun run check:full` (см. §5 — bun run check:full) | exit 0 → PASS |
| 2 | Production build | `next build` — оговорка среды: запускать только при остановленном dev-сервере и с ограничением heap (среда склонна к OOM); если собрать невозможно — честно пометить `BUILD NOT RUN`, не «соберётся в CI» | BUILD OK / BUILD NOT RUN |
| 3 | Браузерный smoke | ключевые маршруты: `/`, каталог, карточка, корзина/checkout, `/api/health/live` + `/api/health/ready`, dashboards трёх ролей | 0 console errors на пройденных маршрутах |
| 4 | Секреты-скан | grep по diff/release-кандидату: `JWT`, `sk_live_`, `pk_live_`, `AKIA`, `ghp_`, `PRIVATE KEY`, service-role ключи (паттерны как в CI secret-gate, CI_CD.md §1 job 4/5) | 0 находок |
| 5 | Route-error-coverage | `node scripts/verify/route-error-coverage.mjs` | exit 0 (эталон 47/48) |
| 6 | Реестр | статусы `PRODUCT_BACKLOG.md` обновлены (закрытое — DONE с критерием, новое — OPEN) | таблица актуальна |

**Критерий готовности:** каждый пункт имеет результат `PASS` / `FAIL` / `NOT RUN` / `NOT VERIFIED` с причиной; никаких молчаливых пропусков. Набор шагов процессный (автоматизирования «одной кнопки» в репозитории нет — требует проверки/создания при необходимости).

## 9. Процедура отката

- **Локально (рабочее дерево):** возврат к предыдущему SHA выполняется вперёд по истории — восстановлением путей (`git restore --source=<prev-sha>`) и новым фикс-коммитом. `git reset --hard`, `clean -fd`, переписывание истории запрещены (§7).
- **Схема БД:** миграции forward-only (ledger-мигратор, `schema_migrations`); механизма понижения нет. Откат схемы = новый компенсирующий коммит миграции.
- **Данные:** только restore из бэкапа на одноразовую (disposable) БД с последующим переключением — `BACKUP_RECOVERY.md` §4–5.
- Пошаговые серверные процедуры и таблицу «симптом → первое движение» — см. `ROLLBACK_RUNBOOK.md` (§0.1, §2–4); откат выполняется под зарегистрированным инцидентом.

## 10. Резервные копии

- Требование: `bun run ops:backup` перед каждым релизом и по расписанию; `bun run ops:restore-verify` обязателен — бэкап без доказанного восстановления не считается бэкапом (доказательство = успешный restore на disposable БД).
- Расписания и текущие статусы (maintenance.yml — READY FOR OWNER APPROVAL) — `MONITORING.md` §3/§6; механика — `BACKUP_RECOVERY.md`.

## 11. Действия при недоступности БД

- Проверки, не требующие БД, продолжаются: typecheck, lint, unit-тесты без БД, route-error-coverage, статический секрет-скан.
- DB-зависимые проверки помечаются `NOT VERIFIED` (с причиной) — никогда `PASS`.
- `register-failure` остаётся в pending-файле (§5, fail-open) и ретраится при восстановлении БД; ручной повтор прогона — после восстановления.
- Никаких фиктивных PASS; итог гейта при пропуске DB-зависимых пунктов = «не готов» по этим пунктам.

## 12. Ограничения автоматизации

- Система НЕ правит production-код сама: автоматизация — регистрация, группировка, классификация-подсказка, уведомления, проверки, фиксация результатов.
- CRITICAL/HIGH — только с назначенным человеком; авто-исправление запрещено.
- Авто-фиксация ошибок — да (§2); авто-исправление — нет.

## 13. Известные технические долги (сводка)

Единый реестр — `PRODUCT_BACKLOG.md` (IDs ниже — оттуда). Кратко:

| ID | Суть |
|---|---|
| ZV31-002 | Кумулятивная конкурентная гонка order write-off (TOCTOU между валидацией и применением; validateOrderWriteOffAgainstSnapshot читает реестр до применения) |
| ZV31-003 | Нетранзакционное обновление состава рецепта (PATCH мутирует корень и ingredients отдельными запросами) |
| ZV31-004 | PostgreSQL integration verification — NOT VERIFIED: embedded PG не инициализирован (`.pgdata` отсутствует в корне рабочего дерева; подтверждено чтением дерева), клиентские утилиты не настроены |
| ZV31-005 | Документ ZV30 (`docs/audits/ZV30_TRANSACTIONAL_CONSISTENCY_AND_WRITE_OFF_AUDIT.md`) не создан (обрыв сессии); восстановить по 20-секционному плану Z-v30 либо заменить ссылкой на этот документ по решению владельца |

---

**Итог честности этого документа:** архитектура §2–§4, константы и переходы — из кода (фактически прочитанные файлы); механизм checks-реестра §5 — каркас создан (`scripts/regression/*`, команды `check:quick`/`check:full`), e2e-прогон выполнен 2026-11-12: check:quick exit 0 (PASS), check:full exit 1 — единственный FAIL vitest = redline-guard по 4 удалённым защищённым upload-файлам (корректное срабатывание защиты, конфликт зафиксирован как ZV31-016); регистрация падения в БД подтверждена (registered_at выставлен, повтор после поднятия embedded PG), инцидент виден в админ-панели «Инциденты» (P2/NEW/infrastructure); PASS⇔exit 0 подтверждена в обоих режимах. Актуальная сводка статусов верификации — блок «Статус верификации Z-v31 (2026-11-12)» ниже.

**Статус верификации Z-v31 (2026-11-12):**

- HEAD e9d6f4d; ветка main; рабочее дерево: 4 незакоммиченных удаления защищённых upload-файлов (STOP по §14) + артефакты проверок docs/operations/checks/
- Embedded PostgreSQL поднят (порт 54329, БД conditera, 79 миграций, без бизнес-сидов); /api/health: database ok, status ok, auth=GoTrue stub (unreachable by design)
- Раннер: honesty PASS⇔exit 0 подтверждена; failure-registration loop e2e подтверждён (pending → registered)
- Три роли проверены в браузере 3/3 (покупатель: регистрация→кабинет→пустые состояния→logout; кондитер: 5 табов; админ: Инциденты/CMS/n8n/Пользователи); мобильная вёрстка 390×844 держится; 0× HTTP 500
- Статус PRODUCT OPERATING SYSTEM: PARTIAL; готовность продукта: NOT READY до решения ZV31-016 (плюс ZV31-017 mock-каталог, PG-интеграция бизнес-сценариев NOT VERIFIED на реальных данных)
- Дополнение Z-v32 (Пакет A, 2026-11-12): ZV31-016 CLOSED — 4 защищённых upload-файла восстановлены из HEAD, redline-guard PASS (exit 0), защитные механизмы не изменялись

**Статус Z-v32 (2026-11-12): RELEASE CANDIDATE**

- HEAD 1ab0b07; ветка main; рабочее дерево чистое. Итоги пакетов Z-v32:
- Пакет A: ZV31-016 CLOSED — 4 upload-файла восстановлены bit-for-bit, redline 9/9.
- Пакет B: ZV31-006/007/011/017 CLOSED — верифицировано.
- Пакет C-1: ZV31-002/003 DONE — миграция 0081, RPC `apply_order_write_off_atomic` / `update_recipe_with_ingredients`, SQL 24/24. Пакет C-2: 11/11 интеграционных сценариев PASS на реальном PG (webhook replay идемпотентен, 2 конкурентных списания — 1 победитель; snapshot в orders.metadata; находки LOW: нет восстановления склада при cancel, stub-refund невозможен).
- Пакет D: 3/3 роли браузер PASS (заказ UK-2026-286175, чат в комнате заказа, block/unblock, инцидент NEW→TRIAGED с историей, фото-загрузка через /api/upload).
- Пакет E: CMS полный цикл PASS (draft→preview→publish→rollback, 409 CMS_CONFLICT, баннер create→публично→скрыть→удалить, аудит); ZV31-001/012 CLOSED.
- Пакет F: mobile-app → archive/mobile-app NOT MAINTAINED, ZV31-015 CLOSED.
- Release gate: PASS (exit 0) — 5 проверок: typecheck, eslint, vitest, route-error-coverage, secrets-scan; secrets-scan 0 находок.
- Production build: FAIL — kernel OOM, предел среды (4GB no-swap pod; next-build ~2.5GB RSS; dmesg global_oom; exit 137 ×3; компиляция успешна; tsc --noEmit PASS отдельно). Действие владельца: выполнять `bun run build` на машине ≥8GB RAM или с swap (CI).

Матрица готовности (Z-v32):

| Компонент | Статус |
|---|---|
| Build | FAIL (среда: kernel OOM на 4GB no-swap; компиляция успешна — предел среды, не дефект кода) |
| TypeScript | PASS |
| ESLint | PASS |
| Tests | PASS |
| PostgreSQL | PASS (81 миграция, чистая БД) |
| Auth | PASS (собственный JWT; GoTrue stub — прод-провайдеры настраивает владелец) |
| OAuth | НЕ НАСТРОЕН (нужны creds Yandex ID/VK ID) |
| Payments | PASS (stub-адаптер; прод YooKassa — creds владельца) |
| Uploads | PASS (маршруты восстановлены, redline-guard) |
| Chat | PASS (JWT handshake, доставка, persistence) |
| Roles | PASS (3/3, server-side guards, auth-matrix 12 кейсов) |
| CMS | PASS (версии/публикация/откат/аудит/preview) |
| Secrets | PASS (0 находок) |
| Monitoring | PASS (инциденты, статусы, метрики) |
| Backups | НЕ ГОТОВО (стратегия требует решения владельца) |
| HTTPS | НЕ ВЕРИФИЦИРОВАНО (прод-домен вне песочницы) |
| SEO | PASS (robots/sitemap 200, metadata) |
| Mobile | ARCHIVED (вне scope) |

Действия владельца (прод-конфигурация):

1. real JWT_SECRET / DB creds для прода;
2. OAuth Yandex ID + VK ID callback URLs;
3. YooKassa prod ключи + webhook URL;
4. домен + HTTPS (Caddy prod);
5. CRON_SECRET для n8n;
6. стратегия бэкапов PG (pg_dump cron) + проверка восстановления;
7. запуск build на машине ≥8GB;
8. CORS/cookies/rate-limit ревизия перед публичным деплоем.

## Z-v32 ADDENDUM: система цен с историей (2026-11-12)

Первичное описание подсистемы цен Z-v32 (последние коммиты PR-5/PR-6A2/PR-6B). Реестр остатков — `PRODUCT_BACKLOG.md` (ZV32-005/006/007). Факты ниже — из миграций/кода/прогонов этого пакета.

### Архитектура

| Элемент | Факт |
|---|---|
| product_price_history | миграция 0083: интервалы half-open `[from, to)`; запрет пересечений — EXCLUDE no-overlap через `btree_gist` (SQLSTATE 23P01); идемпотентность повторной записи — partial-unique; аудит изменений — `product_price_audit` |
| Функции | `set_product_price` / `get_product_price_at` / `sync_effective_product_prices`; миграция 0086 добавляет в `set_product_price` guard same-instant |
| Привязка заказов | миграция 0084: `order_items.price_version_id` |
| Срок предложений | миграция 0085: `negotiations.valid_until` + `confectioner_quotes.valid_until` + DB-триггер-бэкстоп |
| Единицы денег | INTEGER RUB (identity 0034); исключение: `negotiations.quoted_price` — копейки (конвертация в одной точке, закреплено pinned-тестом); date-only даты — в TZ мастерской Europe/Moscow (+03:00) |
| Леджер миграций | 85 строк / 86 файлов; чистая БД: 84/84 применяются без ошибок (проверка PR-6A) |

### API-поверхность

- Кондитер: `GET/POST /api/confectioner/products/[id]/price-history`, `.../price-at`, `.../price`, `.../cost-analysis`.
- Админ: `POST /api/admin/price-history/correct` — коррекция истории с правилом HISTORICAL_IMMUTABLE (закрытые и planned интервалы не мутируются).
- Checkout/orders/b2b binding: `order_items.price_version_id` + `orders.metadata.pricing` `{resolvedAt, items[{productId, priceVersionId, unitPrice}], deliverySource}`; индивидуальные предложения — `metadata.offerBinding`.
- `POST /api/orders`: расчёт доставки серверный; клиентское значение сохраняется только в `metadata.pricing.deliveryClientSubmitted` (дефект D2-класса «клиентский deliveryCost» устранён серверным расчётом).

### Порядок изменения цены

- Два режима: now-активация (интервал `[now, ∞)`) и планирование на будущую дату (planned-интервал, с превью и подтверждением в UI).
- Catch-up / lazy sync: `sync_effective_product_prices` отложенно активирует planned-интервалы при чтении.
- Идемпотентность: повторная запись того же интервала не создаёт дубль (partial-unique).
- Конфликты: пересечение интервалов — 23P01 из EXCLUDE; same-instant цена — 409 (0086; до фикса D2 был 500).

### Фиксация цены в заказе

- Цена в заказе — версия: `order_items.price_version_id` (0084); снимок — `orders.metadata.pricing` (resolvedAt, per-item priceVersionId/unitPrice, deliverySource).
- Индивидуальные предложения: `metadata.offerBinding` фиксирует согласованную цену; истечение — `negotiations.valid_until` (0085 + триггер-бэкстоп).

### Правила неизменности и UI

- HISTORICAL_IMMUTABLE: закрытые и planned интервалы неизменяемы; админ-коррекция — только вперёд (новым состоянием, не правкой старого).
- Кабинет кондитера: панель «Цены и история стоимости» — история, календарь, планирование (превью + подтверждение + идемпотентность), цена на дату, себестоимость с честными маркерами и предупреждениями.
- Каталог покупателя: маркер «от» (isFromPrice), «Цена действует с DD.MM.YYYY», защита от фиктивных скидок (hasRealDiscount); история цен покупателю не раскрывается, future-цены не утекают.

### Результат верификации

- SQL 10/10 (PR-1A: конкурентная запись двумя клиентами — 1 победитель, 23P01 на пересечение, catch-up).
- Интеграция HTTP: 18/21 → после фиксов D1–D4 повторно 8/8.
- Браузер: PASS (планирование с превью; future не утекает покупателю).
- Unit: 29+13+21+26+22 новых тестов.
- Полный гейт: `bun run check:full` PASS, exit 0 (5/5 проверок, secrets-scan 0 находок); чистая БД 84/84 миграций.

### Дефекты, найденные и исправленные в пакете

- D1 — initial-строка истории при создании товара; D2 — same-instant 500 → 409 (0086); D3/D4 — семантика active/planned (history и коррекция). Ранее в Z-v32: upsert atelier PK, 3 TS-ошибки cms. Дефект D2-класса «клиентский deliveryCost в /api/orders» — устранён серверным расчётом доставки.

### Ограничения (остатки — в backlog)

- confectioner_quotes: accept-endpoint отсутствует; UI предложений (countdown/validDays/checkout negotiationId wiring) — ZV32-005.
- Admin read-only панель истории цен, бейдж «Запланировано», дефолт даты планирования — ZV32-006.
- Варианты товара: schema-ready (0083), но мёртвый код — роуты цен пинуют `variant=NULL`; `wholesale_prices` (b2b) вне истории цен (version NULL по решению) — ZV32-007.

---

## Цикл Z-v33 (финальный, 2026-11-13)

**Статус:** RELEASE CANDIDATE. Вердикт — OWNER ACTION REQUIRED (код готов; production build + конфигурация + push — действия владельца). Эталон цикла — `docs/release/RELEASE_CANDIDATE.md`; gate-артефакт — `docs/operations/checks/Z-V33_FINAL_GATE.md` (+ ADDENDUM ZV33-9b).

### Хронология пакетов (кратко)

- ZV33-4 — UI индивидуальных предложений поверх готового бэкенда: вкладки кондитера/покупателя, offer-format (МСК, копейки→₽), Zustand `pendingNegotiationId`, checkout-binding, cart-drawer/cake-builder навигация. Запись: `agent-ctx/ZV33-4-zai-code.md`.
- ZV33-5 — ZV32-005 end-to-end (9 проверок: accept, 410 OFFER_EXPIRED, 409 OFFER_ALREADY_ACCEPTED, подмена цены невозможна, серверная цена 15 000 ₽, фиксация переживает изменение цены, revisions, TZ). Дефект D1 «один заказ на переговоры» закрыт: 409 OFFER_ALREADY_ORDERED + условная ссылка order_id; D3/D4 — статус и цена в обеих ролях. **ZV32-005 → CLOSED.**
- ZV33-6 — CMS-регрессия Part A (draft→preview→publish→409 CMS_CONFLICT→rollback→banners→audit ALL PASS); Part C — чистка mock-поверхности.
- ZV33-7b — удалены live-мок-фолбэки: `/api/recipes/[id]/acceptances` (фабрикация кондитеров при пустом результате) и `/api/video-feed` (маскирование ошибки БД → честный 503).
- ZV33-8a/8b/8c — роли с доказательствами: покупатель (регистрация 201 + автологин, покупка UK-2026-943071 c `order_items.price_version_id NOT NULL`, серверная доставка, чат, отмена по правилам, негативные 403/400), кондитер (товар с фото через защищённый upload 201, Acceptance Gate GREEN, история цен, PENDING→CONFIRMED), админ (block/unblock → login 403, матрица прав 8 роутов × 4 роли PASS).
- Security — `/api/auth/session` + `/api/auth/refresh` отдают 403 ACCOUNT_BLOCKED и чистят cookie для заблокированных профилей; upload role-guard в `src/proxy.ts` + `src/lib/upload-role-guard.ts` (без изменения 4 защищённых файлов): `/api/upload` — CONFECTIONER/ADMIN/SUPER_ADMIN + CUSTOMER (фото отзывов/тикетов), `/api/services/upload` — только manager; live-пробы: blocked 403, buyer→services 403, confectioner/admin 201, unauth 401.
- Честные данные — seed-бэкфилл `product_price_history` в `scripts/db/setup.mjs` (идемпотентно, 12/12 товаров версированы); ZV33-9b — quick-режим secrets-scan исключает gitignored-файлы + токен-фикстура refresh-теста переименована.
- Урок ZV33-3b — при ротации `JWT_SECRET` перегенерировать Supabase-ключи той же HS256-схемой (iss=local, role claim), иначе PostgREST-шим деградирует их до anon.

### Итоговый gate (ZV33-9 + ADDENDUM ZV33-9b, 2026-11-13)

- check:full exit 0 (typecheck 4.5s, eslint 46.3s, vitest full, route-error-coverage 47/48 — script-documented exemption, secrets full 0 findings/1801 файлов); standalone vitest: **146 файлов / 1922 теста, 0 failed, 0 skipped, 142.88s**; redline 9/9 + protected-paths status H×4; миграции 85 файлов = 85 ledger-строк (пропуски 0056/0073 — норма, 0016b/0017b присутствуют).
- PG-интеграция: committed equivalents 39/39 (inventory 8/8, checkout idempotency 15/15, diagnostics 16/16); точный 11-сценарный harness Z-v32 C-2 — эфемерный, NOT RUN (честно задокументировано).
- check:quick: до ZV33-9b exit 1 (8 false-positive findings: gitignored `.env.local` ×7 + 1 тест-фикстура); после ZV33-9b — **exit 0**. check:full — без изменений exit 0.
- Матрица 15 строк: **PASS 13 / FAIL 0 / NOT RUN 2** (NOT RUN = строки 9 Production build и 10 smoke — OWNER ACTION REQUIRED: песочница 3.9 GiB RAM/no swap + запрет запуска, OOM-прецедент exit 137).

### Backlog-дельты цикла

ZV32-005 → CLOSED (предложения end-to-end); ZV32-003 → CLOSED (не воспроизводится, live-only vitrine подтверждён); ZV31-016 — примечание о рецидиве 2026-11-13 (drift-удаление upload-файлов, восстановлено `scripts/protected-paths.sh repair`, guard 9/9, skip-worktree не использовался); ZV32-002 остаётся OPEN P3 с меткой DEMO/NOT IMPLEMENTED (admin UI only); ZV32-001/004/006/007, ZV31-008, ZV31-014 — OPEN, не блокеры (P3/P4); новые строки ZV33-001 (P3, назначение PENDING-заказов) и ZV33-002 (P4, косметика).

### Правило остановки

**Разработка в цикле Z-v33 прекращена.** Все находки дальше — только в `PRODUCT_BACKLOG.md` как P3/P4 (не блокеры публикации); никаких новых пакетов/аудитов до решения владельца о push и deploy. Дальнейшие шаги — только действия владельца по RELEASE_CANDIDATE.md §5.
