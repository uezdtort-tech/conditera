# Z-v25 — INDEPENDENT FINAL RELEASE READINESS REPORT

**Дата проверки**: 2026-11-11 (UTC) · **Начало**: ~13:57 · **Окончание**: ~15:45
**Аудитор**: Z-v25 (независимый) — предыдущие отчёты Z-v22/Z-v24 использованы как навигация, НЕ как доказательства; каждое утверждение перепроверено фактически.

---

## 1. Фактический HEAD и ветка (до аудита)

| Параметр | Значение |
|---|---|
| Директория / репозиторий | /home/z/my-project · uezdtort-tech/conditera |
| Ветка | `main` (фактически проверена) |
| HEAD до аудита | `3c10708ac1533f5fbf897c56cbf4da0fe9a80d36` (2026-11-11 13:54:37 +0000) |
| HEAD после аудита | `3c10708` + финальный коммит отчётов Z-v25 (см. §24) |
| Ahead/behind (без fetch) | 236 ahead / 0 behind origin/main (по имеющимся refs) |
| Рабочее дерево до | чистое (0 записей) |
| Stash / незавершённые ops | пусто / нет (нет MERGE_HEAD, rebase-*, CHERRY_PICK_HEAD) |

## 2. Git status до и после

- **До**: чистое дерево; только штатные процессы (dev-server :3000, embedded PG 18.4 :54329, mini-services bun).
- **После**: только новые артефакты аудита: `agent-ctx/zv25-worklog.md`, `agent-ctx/zv25/*` (скрипты проверок, логи, скриншоты), `docs/release/Z-V25_*.md` (4 документа). Трекнутые файлы НЕ модифицированы. Секреты (токены тестов) удалены.
- **Snapshotter**: UUID-коммиты b126f6a/1ceaa4b/2f52a55 проверены `git show --stat` — **фактически пустые** (подтверждено независимо, не по отчётам). Активных snapshot-процессов нет; HEAD в ходе аудита не двигался.

## 3. Проверка защищённых файлов

Метод: только метаданные (существование, git-флаги, блоб-хеши) — содержимое не читалось.

| Файл | Существует | Worktree | Блоб wt == индекс == HEAD | Флаг |
|---|---|---|---|---|
| src/app/api/upload/route.ts | да | clean | MATCH (cb23e5dd…) | H |
| src/app/api/upload/route.test.ts | да | clean | MATCH (06b49c3c…) | H |
| src/app/api/services/upload/route.ts | да | clean | MATCH (f6c52a42…) | H |
| src/app/api/services/upload/route.test.ts | да | clean | MATCH (ec9f8efc…) | H |

Механизм защиты: `core.hooksPath=scripts/hooks` → pre-commit → `scripts/protected-paths.sh hook-guard` (файл существует, tracked, clean). **Отклонение от описания ТЗ (INFO)**: guard фактически в `scripts/protected-paths.sh` (не `scripts/hooks/`); skip-worktree в данный момент выключен (управляется режимами `skip-on/skip-off` самого скрипта; активная защита — pre-commit hook-guard). Инцидентов/`D`-статусов не обнаружено; остановки по §14 не требовались.

## 4. Фактическая история изменений (Z-v24 → Z-v25)

- `a084a4e` (Z-v24 fix): существует; удалил зомби `0062_cart_custom_items.sql`, добавил `0080_cart_remove_zombie_check.sql`, удалил `scripts/apply-0062-cart-custom-items.ts` и `src/lib/validations/cart.ts`, харденинг setup.mjs/init-db.sh/CI.
- После Z-v24: `394e241` (docs), `b126f6a` (UUID, пустой — проверено), `3c10708` (docs+worklog, 3 файла). **Изменений кода/миграций после Z-v24 нет**; автоматических (snapshot) содержательных коммитов нет.

## 5. Независимая проверка Z-v24 — ВЕРДИКТ: ПОДТВЕРЖДЕНО

14/14 вопросов о миграциях — PASS (зомби удалён, дублей ID нет, metadata-ссылок нет, DROP-before-rescue доказан эмпирически, rescue без потерь, NULL/условный DROP COLUMN корректны, обычные товары не затронуты, RLS не нарушен, идемпотентность, частичное применение/повторный запуск безопасны, леджер честен).

**Сценарии на disposable PG 18.4** (не доверяя Z-v24, воспроизведено заново):
- **A — чистая установка: 18/18 PASS** (штатный setup.mjs, exit 0, ledger 79/79; 248 таблиц/356 функций/67 триггеров; cart_items: custom_config+client_ref, без metadata, kind_check корректен, RLS+4 owner-политики).
- **B — легаси-обновление: 24/24 PASS** (B1: перемотка леджера до-0080 + зомби-артефакты + данные → **штатный upgrade exit 0**, зомби-CHECK снят, данные целы, custom-вставка работает; B2: rescue metadata→custom_config полный, NULL не тронуты, порядок DROP→UPDATE доказан отрицательной пробой 23514; B3: 0080 no-op + идемпотентность).
- **C — сбои: 6/6 PASS** (SQL-ошибка → exit 1/откат/чистый леджер/fail-fast; дубликат ID → блокировка ДО SQL; повторный запуск после устранения → exit 0).

**HTTP-уровень**: custom item → 200 inserted (регресс P1 Z-v24: было 500/SQLSTATE 23514) — подтверждено на реальном API (28/31; 3 каскада от F1).

## 6. Анализ миграции 0080

`0080_cart_remove_zombie_check.sql`: (1) `DROP CONSTRAINT IF EXISTS cart_items_product_or_custom_check` — идемпотентно, до переноса данных; (2) DO-блок: rescue `custom_config = metadata WHERE product_id IS NULL AND custom_config IS NULL AND metadata ? 'custom'`, затем условный `DROP COLUMN metadata` только при пустоте (иначе NOTICE + сохранение данных). На чистых установках — полный no-op. На проверку частично-выполненного состояния: через setup.mjs файл выполняется в транзакции (частичное состояние невозможно); psql-пути — шаги идемпотентны, повторный запуск добирает. Ответы на все 14 вопросов §2.1 ТЗ — в worklog (agent-ctx/zv25-worklog.md).

## 7. Проверка migration runner

| Раннер | Дубликаты до SQL | Fail-fast | Леджер | Exit при ошибке | Используется |
|---|---|---|---|---|---|
| scripts/db/setup.mjs | да (C3) | да (откат файла, сиды пропущены) | schema_migrations честный | 1 | локальный (npm run db:setup) |
| supabase/init-scripts/01-apply-migrations.sh | да | да (ON_ERROR_STOP=1) | да | 1 | CI ci.yml migrations-pg18, Dockerfile, docker-compose* |
| scripts/init-db.sh | нет (но честное падение) | да (FAILED_MIGRATIONS→exit 1) | нет | 1 | Docker dev |
| scripts/apply-migrations.ts | нет | **нет (fake-success)** | нет | **0 при failed>0 — F2** | НИГДЕ не подключён |

11/11 требований ТЗ к активным раннерам — выполнены (эмпирически C1–C3, B1-rerun). F2 — legacy-скрипт вне активных путей (P2, рекомендация).

## 8. Clean install — Сценарий A: PASS (18/18)

## 9. Upgrade — Сценарий B: PASS (24/24)

## 10. Security findings

**P0/P1: не найдено.** Классифицированные наблюдения:
- **F7 (INFO)**: 89/248 таблиц без RLS; 28 голых `USING(true)` политик (в осн. публичные SELECT-справочники — намеренно; financial_ledger — отдельная схема без USAGE для anon; 3 INSERT-only системных лога). Контекст: локальный рантайм ходит в БД только под service-role/superuser → гейт — API-слой (getUserFromRequest + role-guards); RLS — defense-in-depth. Для Supabase/PostgREST-деплоя — пересмотреть (владелец).
- Аутентификация: JWT (HS256, JWT_SECRET, fail-closed без unsafe-default), роли из серверного подписанного payload (не клиентские claims), blocked-check кэш 60s, 2FA с анти-брутфорсом (Z-v20), refresh-токен отдельным секретом. Практически: register/login/logout/session/refresh-cookie — PASS; выход требует CSRF (fail-closed).
- Роли: ROLE_PRIORITY (30 ролей) — единый источник клиент/сервер; `dashboardViewByRole` компиляторски полон; HOME/ENTERPRISE не являются ролями (BUSINESS — только тариф); D-01 (primary role) подтверждён практически (CUSTOMER → кабинет CUSTOMER).
- API: ownership (чужая корзина 404, ops/summary 403 с ролями), CSRF double-submit, rate-limiting многослойный (in-memory + anti-fraud 3/час+10/день — работали честно на мне), SQLi/XSS пробы чисты, ошибки без stack/SQL.
- **Secrets scan**: дерево + 300 коммитов истории по паттернам sk-/AKIA/PRIVATE KEY/ghp_/xoxb/eyJ/sk_live — реальных секретов нет (eyJ — плейсхолдеры examples; sk_live — детекторы). .env* в .gitignore. Проверено файлов: все tracked (git grep) + история. Категории: 0 реальных, 0 вероятных, примеры/плейсхолдеры ~6, ложные срабатывания (бинарники/паттерны) ~10.

## 11. Secrets scan — см. §10.

## 12. Бизнес-сценарии

| Контур | Доказательство | Статус |
|---|---|---|
| Жизненный цикл заказов | order-lifecycle-verify 81/81 (создание→производство→доставка→завершение, права участников, запрещённые переходы, аудит) | PASS |
| Корзина | HTTP 28/31 (3 каскад F1) + изоляция/дедуп/конкурентность | PASS |
| Checkout | 10/10 (цены серверные, идемпотентность, snapshot, custom-снимок) — при настроенных данных | PASS* |
| Промокоды | WELCOME10 10% серверно + first-order restriction (повтор → 422) | PASS |
| Инвентарь/рецептуры | inventory-concurrency 8/8 (атомарность, журнал, без lost update) | PASS |
| Платежи | код полный (webhook IP-allowlist IPv4+IPv6, refund-сверка); локально stub (isStub) — sandbox требует credentials | PARTIAL (внешнее) |
| Возвраты | refund-маршрут + сверка в коде; реальные платежи запрещены | PARTIAL (внешнее) |
| Чаты | socket.io E2E: JWT-auth, room access (fail-closed через API), доставка A→B, senderId из JWT, typing | PASS |
| Курьер | покрыт lifecycle 81/81 | PASS |
| Diagnostics/Ops | 16/16, 37/37 | PASS |
| F1 | acceptance-gate: на демо-данных checkout товаров заблокирован (владелец: конфигурация) | P1 data-readiness |

## 13. Интеграции

| Интеграция | Код реализован | Локально проверена | Sandbox проверен | Credentials доступны | Статус |
|---|---|---|---|---|---|
| PostgreSQL 18.4 (embedded) | да | да (все сценарии) | — | локальные | **OPERATIONAL** |
| Собственный JWT-auth (замена Supabase GoTrue) | да | да (register/login/session/refresh/logout) | — | локальные | **OPERATIONAL** |
| Socket.io chat (mini-service :3030) | да | да (E2E) | — | локальные | **OPERATIONAL** (см. F5/F6 про супервизию) |
| n8n | receiver (:5678) | receiver жив; **workflow-engine отсутствует** | нет | N/A | **PARTIAL: receiver OK, engine NOT OPERATIONAL** |
| YooKassa | полный адаптер | stub-поток (isStub); webhook-верификация в юнитах | нет | нет | **NOT OPERATIONAL (нужны credentials)** |
| Yandex ID OAuth | да | 501 fail-closed без credentials | нет | нет | **NOT OPERATIONAL (нужны credentials)** |
| Google OAuth | status-флаг | не проверялась | нет | нет | **NOT OPERATIONAL** |
| VK ID | не реализован на main (честный 501) | 501 подтверждён | нет | нет | **NOT IMPLEMENTED (501)** |
| Email (SMTP) | адаптеры email.ts, email-confectioner.ts | не проверялась | нет | нет | **NOT OPERATIONAL (нужны credentials)** |
| Telegram | token-based | не проверялась | нет | нет | **NOT OPERATIONAL** |
| Meilisearch | smoke-скрипт есть | не запущен в среде | — | — | **NOT RUN / опционально** |
| Simplex bridge (:5226) | mini-service | процесс жив (E2E не проверялся) | — | — | **PARTIAL** |
| Ollama (LLM self-host) | фолбэк-цепочка в коде | не проверялась | нет | локальный URL | **PARTIAL (fail-safe в коде)** |

## 14. UI/browser

Agent Browser: главная (desktop+mobile iPhone 14), каталог (12 товаров, категории), карточка (рейтинг/цена/«В корзину»), добавление в корзину (тост, бейдж), корзина (промо-поле, суммы 2400+300=2700), модалка входа (tabs/поля/submit), dashboard («Здравствуйте, ZV25!», полное меню), checkout (визард 1-2-3). Ошибок консоли нет (кроме одного 429-индуцированного fetch — F9). Гидрационных ошибок нет. Горизонтального скролла на 390px нет. Скриншоты: agent-ctx/zv25/ui-*.png. Ограничение: полный E2E-браузерный прогон Playwright (e2e.yml) не выполнялся (NOT RUN — тяжёлый прогон в OOM-стеснённой среде после build; unit-покрытие 1571 + практические сценарии покрывают ключевые флоу).

## 15. Production build

- Попытка 1: `bun run build` → компиляция успешна (65s), SIGKILL на фазе TypeScript; **exit 137**; dmesg: `Out of memory: Killed process 24196 (next-build) anon-rss:2295928kB`; BUILD_ID отсутствовал; повторный запуск безопасен.
- Попытка 2: `NODE_OPTIONS=--max-old-space-size=2048 bun run build` → **PASS, exit 0**: Compiled successfully 71s, 248 статических страниц, BUILD_ID `yVkv6xLZEqu7TdupyFIv8`. Конфигурация проекта НЕ менялась (только env-переменная команды). Dev-сервер после сборки healthy (200).
- Требование к среде для сборки без капа: ≥3GB свободной кучи (или использовать кап 2048 — воспроизводимо).

## 16. CI

5 workflow-файлов: валидный YAML; ci.yml (9 jobs) — минимальные permissions; docker-build с secret-gate сканом образов; staging-deploy — workflow_run+secrets-gate (без secrets владельца деплой невозможен — safe). Находка F3: `branches: ain]` (опечатка → авто-триггер staging не срабатывает; не блокер). Авто-публикации без разрешения владельца не обнаружено.

## 17. Все тесты и exit codes

См. Z-V25_TEST_EVIDENCE.md (полная таблица с командами и кодами возврата). Кратко: tsc 0 · eslint 0 · vitest 109/109 файлов, 1571/1571 · lifecycle 81/81 · inventory 8/8 · checkout-idem 15/15 · diagnostics 16/16 · ops-center 37/37 · route-coverage 47/48 (базлайн) · cart-schema PASS · upload-oversize 8/8 · scan-rules 14/14 · p11 12/17 (5 каскад F1) · backup/restore PASSED · build PASS (heap cap) · NOT RUN: meili-smoke, osv-audit, Playwright E2E.

## 18. Все найденные дефекты

Z-V25_FINDINGS_REGISTER.md: P0=0; P1=1 (F1 — data-readiness, не код); P2=1 (F2 legacy runner, вне активных путей); P3=3 (F3 CI-опечатка, F4 advisory lock, F8 /login); INFO=4 (F5–F7, F9).

## 19. Все исправления и diff

**Исправлений кода не потребовалось** — ни одного доказанного P0/P1 дефекта кода; P2/P3 не подлежат исправлению по правилам §8.1 (не блокеры). Изменения аудита — только новые документы/артефакты (см. §24 diff).

## 20. Открытые блокеры

Z-V25_RELEASE_BLOCKERS.md: 4 блокера запуска (данные товаров, YooKassa cred, OAuth/SMTP cred, инфраструктурные действия запуска) — все уровня «действие владельца», ни один не требует правки кода.

## 21. Итоговая матрица

| Направление | Проверено | Результат | Блокер | Доказательство |
|---|---|---|---|---|
| Git/целостность | да | PASS | — | §1–2, Test Ev §11 |
| Protected paths | да (метаданные) | PASS | — | §3 |
| Migrations | да | PASS | — | §5–6 |
| Clean DB | да | PASS | — | Сценарий A 18/18 |
| Upgrade DB | да | PASS | — | Сценарий B 24/24 |
| Migration runner | да | PASS (F2 вне активных путей) | — | §7, C1–C4 |
| Authentication | да | PASS | — | §10, Test Ev §8 |
| Authorization/Roles | да | PASS | — | §10 (D-01, role-gate 403) |
| RLS | да | PASS (F7 INFO) | — | rls-catalog + изоляция |
| API security | да | PASS | — | CSRF/SQLi/XSS/rate-limit пробы |
| Secrets scan | да | PASS | — | §10 |
| Cart | да | PASS | — | HTTP 28/31 |
| Checkout | да | PASS* (данные владельца — F1) | F1 | checkout 10/10 |
| Orders | да | PASS | — | lifecycle 81/81 |
| Inventory | да | PASS | — | 8/8 |
| Recipes | да | PASS (unit-покрытие + lifecycle) | — | vitest |
| Payments | да (код) | PARTIAL | YooKassa cred | stub + unit |
| Refunds | да (код) | PARTIAL | YooKassa cred | код+unit |
| Chat | да | PASS | супервизия (F5/F6) | E2E |
| Courier | да | PASS | — | lifecycle |
| B2B | частично | PARTIAL | — | маршруты/роуты существуют; глубокий аудит B2B-контента за рамками (§15 ТЗ «не расширять») |
| Integrations | да | PARTIAL | credentials | §13 таблица |
| UI/UX | да | PASS (F8 INFO) | — | §14 |
| Mobile | да | PASS | — | iPhone 14 viewport |
| Browser E2E (Playwright) | нет | NOT RUN | среда | §14 примечание |
| TypeScript | да | PASS | — | exit 0 |
| ESLint | да | PASS | — | exit 0 |
| Vitest | да | PASS | — | 1571/1571 |
| DB tests | да | PASS | — | A/B/C + verify-скрипты |
| Production build | да | PASS (heap cap 2048) | RAM среды | §15 |
| CI workflows | да | PASS (F3 P3) | — | §16 |
| Backup/restore | да | PASS | — | RESTORE-VERIFY PASSED |

Статусы строго по ТЗ §10: PASS/PARTIAL/NOT RUN — без PASS «по доверию».

## 22. Однозначный вердикт

# **READY FOR RELEASE PREPARATION (B)**

Обоснование по критериям ТЗ §11.B:
- Основные проверки пройдены: миграции (clean+upgrade+сбои) PASS, безопасность чиста, бизнес-ядро подтверждено фактически (HTTP+БД), tsc/eslint/vitest/build пройдены, интеграции честно классифицированы.
- Отсутствуют критические дефекты КОДА (P0=0, P1-код=0).
- Остаются только внешние зависимости и формальные действия владельца: конфигурация товарных данных (F1), YooKassa/OAuth/SMTP credentials, супервизорный рестарт chat-server, (опционально) Meilisearch/n8n engine.
- Готовится отдельный план публикации; **публиковать нельзя** до отдельного разрешения владельца.

Почему не A (READY FOR CONTROLLED STAGING): формально открыт P1-пункт F1 (checkout товарных позиций не работает на текущих данных) — по критерию «нет открытых P0/P1» статус A недостижим до выполнения владельцем конфигурации данных. Почему не C (BLOCKED): нет ни одного дефекта кода, блокирующего запуск; все блокеры — владелец/внешние. Почему не D: существенные проверки выполнены (включая production build — в отличие от Z-v22/Z-v24).

## 23. Следующий минимальный шаг

1. Владелец: выполнить БЛОКЕР 1 (конфигурация товарных данных — Z-V25_RELEASE_BLOCKERS.md) → перепроверка `p11-hardening-verify` 17/17 + ручной checkout.
2. Владелец: YooKassa sandbox credentials → sandbox-платёж.
3. Владелец: решить по F2/F3 (рекомендации, 2 строки) — опционально.
4. Только после отдельного прямого разрешения владельца — публикация (push/deploy). Z-v25 ничего не публиковал.

## 24. Изменения аудита (полный список файлов)

Новые (никакие существующие файлы не модифицированы):
- `docs/release/Z-V25_INDEPENDENT_RELEASE_READINESS_REPORT.md` (этот документ)
- `docs/release/Z-V25_FINDINGS_REGISTER.md`
- `docs/release/Z-V25_TEST_EVIDENCE.md`
- `docs/release/Z-V25_RELEASE_BLOCKERS.md`
- `agent-ctx/zv25-worklog.md`
- `agent-ctx/zv25/` (verify-скрипты A/B/C/HTTP/checkout/chat/RLS, логи, скриншоты; токены удалены)

Diff: чисто добавления (untracked → добавлены явным списком, без `git add -A`). Protected paths: не тронуты. Аменд/rebase/reset: не применялись. Push: **NOT PERFORMED**.

---
*Z-v25 · независимый аудит · публикация NOT PERFORMED · остановка после отчёта, ожидание решения владельца.*
