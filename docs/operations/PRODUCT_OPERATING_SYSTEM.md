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

**Статус реализации (честно):** каркас создан (Z31-3-a, проверено чтением рабочего дерева): в `package.json` зарегистрированы скрипты `check:quick` и `check:full`; созданы `scripts/regression/run-checks.mjs` (CLI `--mode=quick|full`; пишет `docs/operations/checks/latest.json` + `history/`, падения — `failures/<fingerprint>.json` с best-effort регистрацией), `scripts/regression/lib/meta.mjs`, `scripts/regression/register-failure.mjs` (bun; `storeErrorEvent` из `@/lib/diagnostics/event-store`; fail-open), тест `src/lib/regression/meta.test.ts`, `docs/operations/checks/history/.gitkeep`, `docs/operations/checks/failures/.gitkeep`. Фактический ПРОГОН `bun run check:quick` / `bun run check:full` ещё НЕ выполнен (NOT RUN — shell был недоступен при создании каркаса), поэтому выходные JSON в `docs/operations/checks/` отсутствуют и результатов проверок пока нет. Правило честности сохраняется: PASS ⇔ exit 0; всё не выполненное — NOT RUN, не PASS.

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

**Итог честности этого документа:** архитектура §2–§4, константы и переходы — из кода (фактически прочитанные файлы); механизм checks-реестра §5 — каркас создан (`scripts/regression/*`, команды `check:quick`/`check:full`), фактический прогон NOT RUN (shell недоступен при создании); всё, что требует shell/браузера (build, живой smoke, DB-верификация), в рамках Z-v31 не выполнялось — статусы NOT VERIFIED/NOT RUN.
