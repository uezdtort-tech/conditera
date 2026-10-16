# Release Gate v4.1 — ИТОГОВЫЙ ОТЧЁТ

Дата: 2026-10-16 (UTC). Автор финальной привязки: сессия «v4.1 close-out» (worklog Task F-1).
Статус публикации: **НЕ выполнялась** (push/merge/deploy/tag запрещены мандатом; ни один новый коммит не отправлен).

---

## 1. Исходное и финальное состояние

| Параметр | Значение |
|---|---|
| Ветка | `main` (локальная, unpublished candidate) |
| HEAD на старте сессии close-out | `12c88153c4dbde310f122b58975fdd8295285c1b` |
| HEAD финальный (после коммита отчёта) | см. §8 — коммит отчёта добавляет ровно один docs-коммит поверх `12c8815` |
| `origin/main` (независимо, `git ls-remote`, эта сессия) | `8454b3ae249801effb6a699abb6633db164a219b` |
| Ahead / behind | **67 / 0** |
| Дерево на старте | НЕ чистое: 4 файла удалены без индексации (drift, см. §2) |
| Дерево после восстановления | чистое (только новые evidence-файлы этой сессии) |
| Локальный diff кандидата против `origin/main` | 191 файл, +30174/−461 |

Исполнение v4.1 (стадии 1–5) выполнено в предыдущей сессии: цепочка `bbe286b` (stage-1 checkpoint) → `8e67d3b`/`b8bdcbf`/`0bcb79a`/`87fe425` (stage-2 фиксы) → `7bcf817`/`50214d6`/`8cbf9c6`/`9ec40f7` (stage-3) → `8252163` (stage-4 гейты) → `97a32a6`/`47ba4d4`/`b567b42` (final alignment) → `12c8815` (Этап 5 handoff). Детальный ledger — `docs/evidence/release-gate/v41-final-handoff-b567b42.md` §2.

Эта сессия (close-out) НЕ меняла исполняемый код: только восстановление drift-удалений до содержимого HEAD, повторный прогон всех гейтов на финальном SHA, живые re-acceptance пробы, evidence и этот отчёт.

## 2. Drift-инцидент этой сессии (задокументирован, восстановлен)

При старте сессии в рабочем дереве отсутствовали 4 отслеживаемых файла (незастейдженные удаления):

- `src/app/api/upload/route.ts`, `src/app/api/upload/route.test.ts`
- `src/app/api/services/upload/route.ts`, `src/app/api/services/upload/route.test.ts`

Это второй подобный инцидент (первый — «drift #7», восстановлен в `bbe286b`; параллельно в этой же сессии вычистился кэш Playwright-браузеров — тот же внешний event перезапуска среды). Доказательства ДО восстановления: `docs/evidence/release-gate/pre-restore-deletion-diff-v41-2-12c8815.txt` (полный diff + status). Восстановление — точечное `git checkout --` по 4 путям (не reset), blob-хэши подтверждены байт-в-байт равными HEAD (`cb23e5dd…`, `f6c52a42…`). Оба upload-маршрута существуют, отслеживаются и не изменялись.

## 3. Список исправлений v4.1 (код — из предыдущей сессии, все в кандидате)

| Коммит | Файлы (суть) | Находка |
|---|---|---|
| `8e67d3b` | `src/app/api/products/[id]/route.ts` (+`fillings` в `PRODUCT_CARD_COLUMNS`), `src/lib/supabase/use-marketplace.ts` (`ApiProduct.fillings` + mapper), 3 тест-файла, evidence (API-JSON, 2 скриншота) | U-06: секция разреза недостижима |
| `b8bdcbf` | `src/lib/postgrest/translate.ts` (сохранение PK базовой таблицы в embedded select), тесты, live spot-check | Список тикетов без `id` |
| `0bcb79a` | `src/lib/upload-service.ts` + оба роута `src/app/api/upload/route.ts`, `src/app/api/services/upload/route.ts` (pre-parse 422 по Content-Length), 3 тест-файла, probe-скрипт | Oversize 400 вместо 422; лимит 10 МиБ не менялся |
| `87fe425` | НОВЫЙ `src/lib/checkout-idempotency.ts`, `src/app/(storefront)/extra-pages.tsx`, `src/lib/supabase/use-marketplace.ts`, 2 тест-файла, live-verifier 15/0 | U-07: дубль заказа при ретрае/таймауте/перезагрузке |
| `7bcf817` | `Dockerfile.simplex-bridge` (+3 строки: chown, `USER node`, `ENV HOME`) | Simplex-bridge от root |
| `8cbf9c6` | `src/app/api/health/route.ts` (живая GoTrue-проба), 11 health-тестов, 3 register fail-closed-регрессии | U-16: слепая зона production-auth |

Финансовая логика (payment/webhook/escrow/payout/refund/bonus): **0 diff** во всех коммитах v4.1 (проверено ledger'ом и подтверждено трассировкой 87fe425 — фикс только на клиенте).

## 4. Статусы DEV-00…DEV-11

| ID | Задача | Статус | Обоснование / evidence |
|---|---|---|---|
| DEV-00 | Checkpoint + сохранение работы | **PASS** | Эта сессия: §1–2; stage-1: `v41-checkpoint-4a901ae.md` (ahead 52/0 на тот момент, SHA всех упомянутых коммитов подтверждены в истории) |
| DEV-01 | U-06 фото разреза | **PASS** (цепочка) + **задокументированное ограничение контента** | Fix-коммит `8e67d3b`; живое полное доказательство на реальном DB+API+UI с синтетической строкой контента (cleanup byte-exact, `U-06-fix-verification-bbe286b.md` §6); на финальном SHA живая проба API: `fillings` присутствует в ответе карточки. Ограничение: в текущей БД объективно 0 продуктов с `products.fillings` и 0 `product_slices` (проверено SQL этой сессии) — позитивный UI-кейс на РЕАЛЬНОМ контенте невозможен до наполнения; зафиксировано как owner-находка №3/4 handoff §3b. Фикстура не выдаётся за production-функцию |
| DEV-02 | Идемпотентность checkout | **PASS** | `87fe425`: клиентский стабильный ключ + серверный opt-in-контракт + индекс 0060; live 15/0 при 87fe425 и **повторно 15/0 на финальном SHA** (эта сессия, `v41-final-u07-live-12c8815.log`, cleanup 5 синтетик-заказов); параллельная гонка и lost-response покрыты; finance-зона не тронута. Открытый пункт: keyless-запросы создают заказ (opt-in) — owner-решение (handoff §3b-1) |
| DEV-03 | Список тикетов (`id`) | **PASS** | `b8bdcbf`: PK сохраняется в shim, JOIN/без JOIN регрессии в vitest (в составе 1011 на финальном SHA), live spot-check с CSRF-парой при коммите; другие потребители конвертера аудированы |
| DEV-04 | Защита от повторной отправки тикета | **OWNER DECISION** (честно не закрыт) | Дубль при byte-идентичном повторном POST воспроизводится (2×201, наблюдение в handoff §3b-2). Варианты: Idempotency-Key на тикетах ИЛИ частичный unique-индекс «один открытый тикет на заказ». Не объединять по похожему тексту — согласовано |
| DEV-05 | Oversize upload контракт | **PASS** | `0bcb79a`: pre-parse 422 по Content-Length на ОБЕИХ роутах, лимит не ослаблен; live 8/0 при коммите и **8/0 на финальном SHA** (`v41-final-upload-live-12c8815.log`); платформенный кап 10 МиБ задокументирован; 400 для chunked без CL — документированное поведение |
| DEV-06 | Production-auth | **PASS** (в объёме песочницы) | Топология определена из кода (GoTrue обязателен); fail-closed регистрации не тронут (0 diff) и зафиксирован 3 регрессиями; `/api/health` получил живую пробу GoTrue (`8cbf9c6`), prod-недостижимость → `degraded`; р réel-провайдер (Kong apikey, латентность) — owner-пункт handoff §3b-8; выбор топологии не подменялся дефолтами |
| DEV-07 | Simplex-bridge non-root + конфиги | **PASS** (статика) / runtime за Docker-гейтом | `7bcf817`: `USER node` и т.д., статические проверки 10/10; чек-лист T1–T6 передан владельцу; MEILI_URL/GIT_SHA/mailu/env-template перепроверены без правок (`50214d6`) и подтверждены на финальном SHA (env-template exit 0 этой сессии) |
| DEV-08 | Привязка результатов к одному SHA | **PASS** | До этой сессии: гейты на `9ec40f7`, после — только smoke-тест (`47ba4d4`) + сканер. Эта сессия перегнала ВСЕ гейты на точном финальном SHA `12c8815` (§5). Vitest 928→925: reconciliation в `v41-checkpoint-4a901ae.md` §3 — только `health/route.test.ts` 9→6 (−3 = ровно расхождение), реворк с доказательством отсутствия ослабления; затем +5 (GoTrue-тесты) → 1011 |
| DEV-09 | GitHub CI и защита main | **BLOCKED / OWNER** | Независимо подтверждено `git ls-remote`: `origin/main` = `8454b3a` — кандидат НЕ опубликован, CI на нём не запускался; старые красные прогоны относятся к старому SHA. Branch protection из песочницы повторно не проверить (GitHub API rate-limit неаутентифицированных запросов) — предыдущее наблюдение владельца `protected: false` остаётся открытым; рекомендации в §7. Push без разрешения не выполняется |
| DEV-10 | Реальный Docker-гейт | **BLOCKED** | Docker Engine в песочнице отсутствует (`docker-engine-check-671f82a.txt`); статический ревью compose/Dockerfile не подменяет сборку. Точные команды — §6 |
| DEV-11 | Повторная приёмка | **PASS** (затронутые сценарии, финальный SHA) | Vitest 1011/1011, prod-smoke E2E 11/0/0/0, health/homepage live 200; U-07 live 15/0; upload live 8/0; U-06 API live + ограничение контента; tally PASS 148/0/0/1/149. Детали §5 |

## 5. Проверки на точном финальном SHA (эта сессия, HEAD = `12c8815`)

| # | Проверка | Команда | Результат | Evidence |
|---|---|---|---|---|
| 1 | TypeScript | `bun run typecheck` | exit 0, 0 ошибок | `v41-final-typecheck-12c8815.log` |
| 2 | ESLint | `bun run lint` | exit 0 | `v41-final-lint-12c8815.log` |
| 3 | Vitest (полный) | `bun run test` | exit 0 — **49 файлов / 1011 тестов**, 0 skip'ов из-за ослаблений | `v41-final-vitest-12c8815.log` |
| 4 | Chat-server strict tsc | `bunx tsc --noEmit --strict …` | exit 0 | `v41-final-chat-tsc-12c8815.log` |
| 5 | Детерминизм E2E (tally-контракт) | `node scripts/verify/e2e-tally-contract.mjs` | **PASS 148/0/0/1/149**, drift 0; единственный допустимый skip — `E2E_FULL_STACK` | `v41-final-tally-12c8815.log` + `tally-contract-12c8815.json` |
| 6 | Production build | `bun run build` | exit 0 (compile 53 s, ~330 маршрутов) | `v41-final-build-12c8815.log` |
| 7 | Prod-smoke E2E на свежем бандле | `E2E_SERVER_MODE=prod bash scripts/e2e-one.sh smoke` | attempt-1: 5/6/0/0 exit 1 — инфраструктура (кэш Playwright-браузеров вычищен перезапуском среды; сервер и API были здоровы); remediation `bunx playwright install chromium`; **attempt-2: 11/0/0/0 EXIT=0** | `v41-final-e2e-smoke-12c8815.log` + `smoke.prod.12c8815-run2.json` |
| 8 | Post-build live | GET `/api/health`, GET `/` | health 200: `status:"degraded"`, `auth:"unreachable"`, `database:"ok"` (документированная prod-форма `8cbf9c6` — fail-closed, не маскировка); homepage 200 | лог smoke + журнал сессии |
| 9 | U-07 checkout idempotency (live) | `node scripts/verify/checkout-idempotency-verify.mjs` | attempt-1 на prod-бандле: 503 «Платёжный шлюз не настроен» — **ожидаемый fail-closed** песочничного prod без конфига шлюза (не регрессия; задокументировано в логе); attempt-2 на управляемом dev-стеке: **PASS 15 / FAIL 0**, cleanup: 5 синтетик-заказов вычищено | `v41-final-u07-live-12c8815.log` |
| 10 | Upload oversize (live) | `node scripts/verify/upload-oversize-verify.mjs` | **PASS 8 / FAIL 0** (422 по контракту, лимит не ослаблен); cleanup: 2 строки storage + 2 файла | `v41-final-upload-live-12c8815.log` |
| 11 | U-06 fillings (live API) | GET `/api/products/{id}` | `fillings` присутствует в ответе карточки (list); SQL-проверка: 0 продуктов с контентом fillings, `product_slices`=0, каталог `fillings`=45 → ограничение контента зафиксировано | журнал сессии + §4/DEV-01 |
| 12 | Evidence hygiene | `node scripts/scan-evidence.mjs` | exit 0 — real findings **0**, 248 синтетик-маркеров | `/tmp/scan-final-check.log` → итог в worklog |
| 13 | Env-template контракт | `node scripts/verify/production-env-template.mjs` | exit 0 (6 required, 63 ключа, только CHANGE_ME) | `v41-final-envtemplate-12c8815.log` |

Никакие результаты более ранних SHA в PASS-статусах §4 не используются: всё перечисленное выше исполнено на `12c8815`.

## 6. Docker-гейт (BLOCKED — команды для владельца)

Проверено: Docker Engine/socket в песочнице недоступен; статическая инспекция не подменяет реальную сборку. Команды (после публикации кандидата):

```bash
# 0. На точно опубликованном SHA:
docker compose config --quiet

# 1. Три требуемые сборки:
docker compose build web
docker compose build chat            # chat-server
docker compose --profile simplex build simplex-bridge

# 2. Инспекция образов + отсутствие секретов в слоях/build-args:
docker image inspect conditera-web --format '{{.Id}} {{.Created}}'
docker history conditera-web --no-trunc | grep -Ei 'CHANGE_ME|SECRET=|PASSWORD=|sk_live' || echo "clean"
docker compose config | grep -Ei 'CHANGE_ME'   # плейсхолдеры допустимы только в шаблоне, не в runtime-env

# 3. Smoke + readiness:
docker compose --profile simplex up -d
docker compose ps                    # все required → healthy
curl -fsS http://localhost:3000/api/health | jq '.status,.database'

# 4. Simplex non-root чек-лист T1–T6: docs/evidence/release-gate/simplex-bridge-nonroot-impl-1a19c29.md §5
```

## 7. Удалённое состояние и безопасный следующий шаг (DEV-09)

**Подтверждено независимо (эта сессия):** `git ls-remote origin main` → `8454b3a…` — кандидат (`12c8815` + отчётный коммит) не опубликован; следовательно **ни один удалённый CI-прогон не относится к кандидату**, включая последний красный E2E (503 `/api/health` — на старом `origin/main`, до коммитов `8cbf9c6`/`47ba4d4`, изменивших контракт readiness и smoke-ассерты; локальный prod-smoke на кандидате зелёный 11/0/0/0).

**Branch protection:** повторная проверка из песочницы невозможна (GitHub API rate-limit для неаутентифицированных запросов; токен в песочнице не хранится — намеренно). Предыдущее наблюдение владельца (`protected: false`, без required checks) остаётся действующим. Рекомендуемые настройки (применяет владелец): Settings → Branches → `main`: запрет прямого push, ≥1 approval, required status checks = `lint-and-typecheck`, `vitest`, `build` (job'ы `ci.yml`) + `e2e` (nightly — как дополнительный, не блокирующий на старте), линейная история — по решению владельца.

**Следующий безопасный шаг:** владелец публикует ТОЧНЫЙ SHA этого отчёта (см. §8) отдельной веткой/PR (не прямой push 67 коммитов), убеждается, что CI запущен на этом SHA, затем выполняет §6. После зелёного CI на точном SHA + Docker-гейта — пересмотр `PRODUCTION-READY`.

## 8. Коммиты этой сессии (close-out)

| Коммит | Содержимое |
|---|---|
| (этот коммит) | `RELEASE-GATE-v4.1-REPORT.md` + 12 evidence-файлов `v41-final-*` / `pre-restore-deletion-diff-v41-2-*` / `smoke.prod.12c8815-run2.json` + `tally-contract-12c8815.json` + worklog-аппенд. Один логический юнит: close-out-привязка. Код не менялся |

## 9. Оставшиеся риски / открытые находки (полный реестр — handoff §3b)

| # | Риск | Влияние | Воспроизведение | Следующий шаг |
|---|---|---|---|---|
| 1 | Keyless checkout создаёт заказ на каждый POST | Финансово-смежный: скриптовые клиенты могут плодить дубли | `POST /api/checkout` без `Idempotency-Key` ×2 → 2 заказа | Выбор владельца: обязательный ключ (422) vs документирование opt-in + мониторинг |
| 2 | Дубль тикета при повторном POST | Шум в поддержке | byte-идентичный POST `/api/crm/tickets` ×2 → 2×201 | Idempotency-Key или unique «открытый тикет на заказ» |
| 3 | Нет контента fillings/slices | U-06-функция невидима в проде-контенте | SQL: `product_slices`=0 | Контент-воркфлоу (seed/админ-CRUD) для флагманских тортов |
| 4 | U-06 позитив на реальном контенте не прогонялся | Медиа-кейсы (aspect, alt) не проверены на масштабе | — | Залить реальные фото срезов 2–3 продуктов → повторить позитивный кейс |
| 5 | Checkout отвечает 200, не 201 | Контракт-несоответствие для строгих API-потребителей | POST `/api/checkout` → 200 | Задокументировать 200 либо перейти на 201 (+регресс-свип) |
| 6 | Simplex non-root: runtime T1–T6 не исполнены | EACCES-класс рисков на `/app/simplex.db` | Docker-гейт §6 | Исполнить T1–T6; откат = удалить 3 строки + rebuild |
| 7 | Firefox/WebKit E2E отключены | Кросс-движковые регрессии невидимы nightly | — | Включить проекты + валидация спеков на обоих движках |
| 8 | Реальный GoTrue-провайдер не проверен | Медленный провайдер может классифицироваться `unreachable` → `degraded` (fail-closed 500 регистрации) | `GET {SUPABASE_URL}/auth/v1/health` в среде владельца | Подтвердить 2xx ≤3 s (или осознанно поднять `GOTRUE_PROBE_TIMEOUT_MS`), затем полный стек с `E2E_FULL_STACK=1` |
| 9 | Удалённый CI на кандидате не запускался; branch protection не подтверждена | Гейты REMOTE-CI/DOCKER = BLOCKED; защита main не гарантирована | GitHub API/Actions | §7 (публикация PR-ом → CI на точном SHA) + §6 |

## 10. Что проверено где

- **Локально (песочница), на точном SHA:** все 13 проверок §5 + приёмочные доказательства §4 (U-06/U-07/upload/tickets/auth — коммитные evidence + live-пробы).
- **Подтверждено через GitHub (независимо, только чтение):** `origin/main` = `8454b3a` (ls-remote); кандидат не опубликован; CI на кандидате отсутствует. Deeper API (protection, runs) — rate-limited.
- **Не проверено (честно):** реальный Docker-гейт; CI на точном SHA кандидата; branch protection (повторно); реальный GoTrue-провайдер; runtime simplex non-root; U-06 на реальном прод-контенте.

## 11. Вердикт

**READY FOR OWNER REVIEW.**

Кандидат собран, локально полностью проверен на точном финальном SHA (`12c8815` + отчётный коммит), дефекты v4.0 из блокирующего списка исправлены или честно вынесены в owner-решения, evidence привязана к SHA, hygiene-скан чист. Публикация, CI на кандидате, Docker-гейт и branch protection — за владельцем (§6–§7).

**PRODUCTION-READY: NO** — до прохождения удалённого CI на точном опубликованном SHA и реального Docker-гейта. Публикация и развёртывание этой сессией не выполнялись.
