# FINAL PRODUCTION BUILD AND SMOKE REPORT — Conditera

**Дата:** 2026-11-14 (UTC). **Задание:** Z-v33 FINAL CONTINUATION — ISOLATED CI RELEASE VERIFICATION via git bundle. Exact commit `2cfa76b0ed7b536a41458a0de939cdc84626b4f2`, перенос в отдельную CI-среду, production build + runtime smoke F1–F6. Без изменения кода, без push, без deploy.

---

## Сводная таблица статусов

| Stage | Проверка | Статус |
|---|---|---|
| A | Exact source commit (ground truth) | **PASS** |
| B | Git bundle creation + verification + SHA-256 | **PASS** |
| C | Transfer to isolated CI environment | **BLOCKED** |
| D | Frozen dependency installation | **NOT RUN** (заблокировано Stage C) |
| E | Production build | **NOT RUN** (заблокировано Stage C) |
| F | Isolated test database | **NOT RUN** (заблокировано Stage C) |
| G | Production server runtime | **NOT RUN** (заблокировано Stage C) |
| H | Smoke F1 / F2 / F3 / F4 / F5 / F6 | **NOT RUN** ×6 (заблокировано Stage C) |
| I | Final Git integrity | **PASS** |
| **J** | **Final verdict** | **BLOCKED** |

---

## A. Exact source commit — PASS

### A.1. Идентификация (фактические команды и результаты)

| Проверка | Команда | Результат |
|---|---|---|
| Remote | `git remote -v` | `origin → https://github.com/uezdtort-tech/conditera.git` — репозиторий `uezdtort-tech/conditera` подтверждён |
| Branch | `git branch --show-current` | `main` |
| HEAD на старте сессии | `git rev-parse HEAD` | **`483e5a1a93202451687bd09e8591e4bc9552b2bf`** — см. A.3 (snapshotter-коммит, НЕ подмена release candidate) |
| Release candidate существует | `git cat-file -t 2cfa76b…` | `commit`, type OK |
| Дерево release candidate | `git rev-parse 2cfa76b^{tree}` | `833b480caed15d195c7dcfdc7b4baaa6918b1259` |
| Родитель | `git rev-parse 2cfa76b^` | `f3687b37ff97b7bc49627262b8d2c82eb7e0c1d4` (Z-v33: честные данные и инструменты) |
| Полнота истории | `git rev-list --count 2cfa76b` | **473 коммита**; `git rev-list --objects 2cfa76b \| wc -l` = **7174 объекта** — все родительские коммиты доступны |
| origin/main (перепроверка) | `git fetch origin` (exit 0) → `git rev-parse origin/main` | `8a31081f40a752f9cef785f67616af6659bcf7e1` — **не изменился** (совпадает с последним известным состоянием задания) |
| Ancestor | `git merge-base --is-ancestor origin/main 2cfa76b` | exit 0 — origin/main является предком release candidate (fast-forward корректен) |
| Опубликован ли commit | `git merge-base --is-ancestor 2cfa76b origin/main` | exit 1 — **2cfa76b НЕ в origin/main**; `git rev-list --left-right --count origin/main...2cfa76b` = `0 283` (283 впереди, 0 позади). Ожидаемо: push заморожен до решения владельца |

### A.2. Защищённые файлы, hooks и guards (на уровне объекта коммита — именно он переносится bundle)

| Объект | Blob в `2cfa76b` | Ожидаемое значение | Совпадение |
|---|---|---|---|
| `src/app/api/upload/route.ts` | `cb23e5dd766be64b0287cd1983dd8d860c361d62` | `cb23e5dd…` | **Точное** |
| `src/app/api/upload/route.test.ts` | `06b49c3c3f22b0a0e6afccef72baf28d60aa818e` | `06b49c3c…` | **Точное** |
| `src/app/api/services/upload/route.ts` | `f6c52a424b0d95a613ec8c0812e0cf106f1b06cc` | `f6c52a42…` | **Точное** |
| `src/app/api/services/upload/route.test.ts` | `ec9f8efcb66397fd29909d72b7d961ec1307a314` | `ec9f8efc…` | **Точное** |
| `scripts/hooks/pre-commit` | `2ba4c13134dae6c354a35ba7297345b1fa319adf` | `2ba4c131…` | **Точное** (и в коммите, и в worktree — `git hash-object` совпал) |

`core.hooksPath = scripts/hooks` — не изменён. `scripts/protected-paths.sh`, `scripts/ensure-dev.sh`, `scripts/db/` — не изменены в worktree (`git diff --exit-code` по этим путям — пусто). Staged-изменения: пусто (`git diff --cached --stat` = 0 строк). `git diff --check` — exit 0.

### A.3. Forensics снапшоттера и drift-события сессии (зафиксировано, ничего не удалено и не сброшено)

При старте сессии (2026-11-14 ~10:44 UTC) обнаружено:

1. **HEAD = `483e5a1`** — commit с UUID-сообщением `b610af38-5ba0-4968-86fb-a4ed7ce0f18b` (авто-коммит sandbox snapshotter, 2026-11-13 21:55:33 UTC). Проверено: родитель — ровно `2cfa76b…`; полный diff `git diff --stat 2cfa76b 483e5a1` — **ровно один файл**: `docs/release/FINAL_PRODUCTION_BUILD_AND_SMOKE_REPORT.md` (+123 строки — незакоммиченный отчёт предыдущего гейта). Код затронут НЕ был.
2. **Snapshotter-коммит `ce0d4525ffc31d775d48c2c2aecb769a2bec10bc`** (reflog: 2026-11-13 21:36:15, UUID-сообщение `8c5b8b2d-7383-49db-994e-80c9ee6ee53b`). Исследован по требованию §2: родитель — ровно `2cfa76b…`; единственное изменение — тот же файл отчёта (+228 строк, промежуточная версия). **Единственное изменение подтверждено как связанное с отчётом.** История НЕ удалена (находится в reflog и в объектной базе); дополнительных reset НЕ выполнялось (предыдущий `reset --soft` выполнен предыдущим агентом и задокументирован в отчёте предыдущего гейта; в текущей сессии сбросов не было).
3. **Staged/unstaged после предыдущего reset --soft:** staged — пусто; unstaged — 4 удаления защищённых upload-файлов (каталоги `src/app/api/upload/`, `src/app/api/services/upload/` отсутствуют целиком) — известный pattern drift-событий песочницы #8–#17 (удаление при старте сессии). Происхождение установлено: инфраструктурное событие; содержимое полностью восстановимо из blob-объектов коммита (проверено в A.2 — все 4 blob'а целы). Не удалялись автоматически, не восстанавливались в worktree — **не влияют на bundle** (bundle пакует объектную базу, не worktree).
4. **~25 untracked-записей старой эры** (`RELEASE-GATE-v4.1…v4.8-REPORT.md`, `FINAL_REPORT.md`, `_quarantine/`, `mobile-app/`, `conditera-pay3.bundle`, `package-lock.json`, `prisma.config.ts`, `schema-patch.sql`, `src/app/en/`, WIP cart-файлов и др.), mtime 2026-09-27…2026-11-10 — содержимое более ранних сессий, восстановленное инфраструктурой песочницы. Происхождение установлено (mtimes старой эры; отсутствовали на конец предыдущей сессии). **Не удалялись, не изучались глубже, в bundle не попадают** (untracked не является объектами коммитов).
5. **Положение HEAD и индекса зафиксировано:** HEAD = `483e5a1` (не менялся в течение сессии), index = HEAD-дерево. Подмены release candidate на HEAD/origin/main не производилось: bundle создан по явному SHA (см. B).

**Критерий PASS §2 выполнен:** exact source commit идентифицирован, содержимое не изменено (дерево `833b480` верифицировано на уровне объектов и clone-тестом в B.3), protected paths на уровне коммита сохранены, hooks/guards не изменены.

---

## B. Git bundle transfer and SHA-256 — PASS

### B.1. Создание

Прямая команда из задания:

```
git bundle create /home/z/conditera-release-2cfa76b.bundle 2cfa76b0ed7b536a41458a0de939cdc84626b4f2
fatal: Refusing to create empty bundle. (exit 128)
```

Причина: git не принимает сырой SHA без ref'а — `2cfa76b` не является tip'ом ни одного ref (`git for-each-ref --points-at 2cfa76b` — пусто: HEAD перенесён snapshotter-коммитом, тегов нет). По правилу §3 («Если команда создания bundle требует изменения исходного репозитория — используй отдельную временную копию») использована **изолированная временная копия**:

```bash
git clone --bare --no-hardlinks /home/z/my-project /tmp/conditera-bundle-src.git
cd /tmp/conditera-bundle-src.git
git update-ref refs/heads/release-candidate-2cfa76b 2cfa76b0ed7b536a41458a0de939cdc84626b4f2
# первая генерация: bundle без HEAD → clone давал unborn 'master'; перегенерировано с HEAD-symref:
git symbolic-ref HEAD refs/heads/release-candidate-2cfa76b
git bundle create /home/z/conditera-release-2cfa76b.bundle refs/heads/release-candidate-2cfa76b HEAD
```

Исходный репозиторий при создании bundle не изменялся (bundle записан вне worktree: `/home/z/…`, temp-копия в `/tmp/…`, обе после тестов удалены).

### B.2. Верификация bundle

```
git bundle verify → …is okay
The bundle contains these 2 refs:
2cfa76b0ed7b536a41458a0de939cdc84626b4f2 refs/heads/release-candidate-2cfa76b
2cfa76b0ed7b536a41458a0de939cdc84626b4f2 HEAD
The bundle records a complete history.
The bundle uses this hash algorithm: sha1
```

| Свойство | Факт |
|---|---|
| Путь | `/home/z/conditera-release-2cfa76b.bundle` (вне исходного кода) |
| Размер | **57 227 126 байт** |
| **SHA-256** | **`44470b99b114bc5e96df54fb87fd581278f73e065a31f15f74f5ffee7949de81`** (зафиксирован также в `/home/z/conditera-release-2cfa76b.bundle.sha256`) |
| Наличие exact commit | Да — оба ref указывают на `2cfa76b…` |
| Родительская история | Полная от корня (473 коммита, без prerequisites) |
| Другие refs | Отсутствуют — ровно 2 ref (branch + HEAD), оба на exact commit |
| Исходники, отличные от exact commit | Отсутствуют — bundle содержит только объекты, достижимые из `2cfa76b` |

### B.3. Clone-тест (сквозное доказательство)

```bash
git clone /home/z/conditera-release-2cfa76b.bundle /tmp/conditera-bundle-test   # exit 0
```

| Проверка клона | Результат |
|---|---|
| `git rev-parse HEAD` | **`2cfa76b0ed7b536a41458a0de939cdc84626b4f2`** — точно |
| Стартовая ветка | `release-candidate-2cfa76b` (допустимо по §4: «другая стартовая ветка — допустимо, HEAD обязан быть точным») |
| `git rev-parse HEAD^{tree}` | `833b480caed15d195c7dcfdc7b4baaa6918b1259` — **байт-идентично release candidate** |
| `git rev-list --count HEAD` | 473 — полная история |
| 4 защищённых blob'а + hook | `cb23e5dd…`, `06b49c3c…`, `f6c52a42…`, `ec9f8efc…`, `2ba4c131…` — все точные совпадения |
| `git status --short` | пусто (0 строк) |

Temp-копии удалены после тестов; bundle сохранён. Передача в публичный GitHub / push НЕ выполнялись (запрещены).

---

## C. CI environment — BLOCKED

Требование §4: отдельная CI-машина или runner, доступный владельцу проекта. **Отдельная CI-среда из данной песочницы недоступна** (нет SSH-целей, зарегистрированных runner'ов или CI-креденшелов; песочница является исходной средой, а не CI-целью).

Фактические ресурсы текущей среды (измерено 2026-11-14, команды §4):

| Ресурс | Факт | Минимум §4 | Соответствие |
|---|---|---|---|
| RAM | **3.9 GiB total** (used 543 MiB, available 3.4 GiB) | 8 GB | **НЕТ** |
| Swap | **0 B** (0 entries) | желательно | нет |
| Свободный диск | **6.4 GB** (rootfs 9.9G) | 15 GB | **НЕТ** |
| CPU | 2 | 2 | да |
| Kernel | `5.10.134-013.15.kangaroo.al8.x86_64` | — | — |
| node / bun | v24.22.2 / 1.3.14 | — | — |

По правилу §4: «Если среда не соответствует минимуму — BLOCKED. Не запускай сборку.» Сборка не запускалась. Двойное основание BLOCKED: (1) отдельная CI-среда недоступна агенту, (2) локальная среда не удовлетворяет минимуму сразу по двум измерениям (RAM и диск).

**Артефакты для передачи владельцу готовы и верифицированы:** bundle (B.2/B.3) + runbook `/home/z/conditera-release-CI-RUNBOOK.md` с полной процедурой Stage 4.1–4.9 для CI-машины.

## D. Frozen dependency installation — NOT RUN

Не выполнялся: заблокирован Stage C (нет среды, соответствующей минимуму). На точном коммите команда — `bun install --frozen-lockfile`, после неё обязательны `git status --short` / `git diff --exit-code` (см. runbook §4.3). Контекст предыдущих гейтов: frozen-lockfile установка проходила с exit 0 (не является доказательством для текущего прогона).

## E. Production build — NOT RUN

Не выполнялся: заблокирован Stage C. Build-time secrets не требуются (проверено на точном коммите ранее; `NEXT_PUBLIC_APP_URL`, `SENTRY_DSN`, `SUPABASE_STORAGE_HOSTNAME` имеют предусмотренные defaults — повторно зафиксировано в runbook §4.4). Команда сборки: `bun run build` (§6). Контекст предыдущих гейтов: в среде с ~3.9 GiB RAM без swap сборка падала по OOM (exit 137) — повторный запуск в несоответствующей среде запрещён заданием.

## F. Isolated test database — NOT RUN

Не выполнялся: заблокирован Stage C. Production DB не использовалась и не проверялась (запрещена). Контекст предыдущих гейтов (справочно, не доказательство текущего прогона): migration ledger 85/85 на отдельной тестовой PostgreSQL 18.4; происхождение `price_version_id IS NULL` у seed-заказа DEMO-1048 установлено — прямая SQL-фикстура в `seed-ops-center.mjs` (metadata `{test:"demo", fixture:"ops-center"}`), обход checkout API; фиксстура не менялась. Для нового тестового заказа на CI обязательна проверка создания `price_version_id` (runbook §4.6).

## G. Production server runtime — NOT RUN

Не выполнялся: заблокирован Stage C и отсутствием BUILD PASS (предусловие §8). Процедура: `bun run start` (имя скрипта сверить по `package.json`), фиксация startup exit code, адрес/порт, логов, HTTP readiness, runtime errors, корректного завершения (runbook §4.7).

## H. Smoke F1–F6 — все NOT RUN

Выполняются только на production build и production server (§9) — предусловия недостижимы (Stage C BLOCKED → D/E NOT RUN). Ни одна функция F1–F6 не заявляется проверенной.

| Проверка | Статус | Причина |
|---|---|---|
| F1 Public storefront | **NOT RUN** | нет production build/server |
| F2 Authentication (login/регистрация/protected routes; Yandex ID, VK ID OAuth) | **NOT RUN** | нет production build/server; OAuth — без настоящих credentials в любом случае NOT RUN |
| F3 Buyer workflow (серверная цена, price snapshot, `price_version_id` нового заказа, серверная доставка) | **NOT RUN** | нет production build/server; платежи YooKassa — без credentials в любом случае NOT RUN |
| F4 Confectioner workflow (свои заказы, предложения, accept/checkout-защиты) | **NOT RUN** | нет production build/server |
| F5 Admin workflow | **NOT RUN** | нет production build/server; admin-аккаунт не предоставлен — NOT RUN в любом случае |
| F6 Security and error handling (401/403/404/409/422/429, ownership, fail-closed) | **NOT RUN** | нет production build/server |

## I. Final Git integrity — PASS

После завершения всех операций (2026-11-14):

| Проверка | Команда | Результат |
|---|---|---|
| Release candidate не изменился | `git rev-parse 2cfa76b^{tree}` | `833b480caed15d195c7dcfdc7b4baaa6918b1259` — идентичен зафиксированному в A.1 |
| HEAD не менялся агентом | `git rev-parse HEAD` | `483e5a1…` — тот же, что на старте сессии (никаких reset/checkout) |
| Source code / migrations / tests / lockfile / package.json / конфигурации | `git status --short`, `git diff` | Ноль изменений, кроме: (а) 4 worktree-удаления защищённых файлов — drift-событие, задокументировано в A.3, blobs в объектной базе целы (A.2); (б) модификация настоящего отчёта — санкционированное заданием §11 создание итогового отчёта по данному пути (файл стал tracked после snapshotter-коммита `483e5a1`; перезапись содержимого — разрешённый deliverable, в index/commit НЕ добавлялся) |
| Protected routes / hooks / guards | `git rev-parse` + `git hash-object` | Blob'ы в `2cfa76b` и worktree-hook совпадают с эталонными (A.2) |
| Snapshotter-история | reflog | `ce0d452…` и `483e5a1…` сохранены, не удалялись |
| Commit / `git add` / push / merge / deploy | — | **Не выполнялись** ни разу в сессии |
| Новые файлы | — | Только отчёт (путь задания) и технические артефакты вне исходного кода: `/home/z/conditera-release-2cfa76b.bundle`, `/home/z/conditera-release-2cfa76b.bundle.sha256`, `/home/z/conditera-release-CI-RUNBOOK.md` |

---

## J. Final verdict

# **BLOCKED**

Выполнение невозможно из-за отсутствия доступа к инфраструктуре: отдельная CI-среда (§4) недоступна агенту, а текущая среда не удовлетворяет минимуму (RAM 3.9 GiB < 8 GB, диск 6.4 GB < 15 GB, swap 0). По правилу задания сборка в несоответствующей среде не запускалась; Stages D–H не выполнялись.

**Что НЕ является заблокированным и выполнено полностью:**
- Stage A: точность release candidate доказана на уровне объектов (дерево `833b480`, 473 коммита, 7174 объекта; защищённые blobs и hooks — точные совпадения);
- Stage B: bundle создан, верифицирован (`verify` — okay, полная история, ровно 2 ref на exact commit) и доказан clone-тестом (HEAD клона = exact commit, дерево байт-идентично, status чист);
- Stage I: целостность исходного репозитория подтверждена — ноль изменений кода/миграций/тестов/lockfile, история snapshotter сохранена, без commit/add/push;
- Инфраструктура передачи готова: bundle + SHA-256 + CI-runbook (`/home/z/conditera-release-CI-RUNBOOK.md`).

Поскольку хотя бы одна обязательная проверка F1–F6 не выполнена (все шесть NOT RUN), полный PASS запрещён (§12). Признаков технических ошибок, регрессий или security-дефектов в самом release candidate в этой сессии не обнаружено — но их отсутствие на уровне runtime не заявляется (не проверялось).

---

## Owner summary (10 пунктов)

1. **Проверенный commit SHA:** `2cfa76b0ed7b536a41458a0de939cdc84626b4f2` (дерево `833b480caed15d195c7dcfdc7b4baaa6918b1259`; origin/main `8a31081` — предок, 283 ahead / 0 behind; commit в origin отсутствует — push заморожен).
2. **Bundle SHA-256:** `44470b99b114bc5e96df54fb87fd581278f73e065a31f15f74f5ffee7949de81`; размер 57 227 126 байт; путь `/home/z/conditera-release-2cfa76b.bundle`; verify — okay; clone-тест — HEAD и дерево точные.
3. **CI resources:** недоступны агенту. Локальная среда: 3.9 GiB RAM / 0 swap / 2 CPU / 6.4 GB диск — НЕ соответствует минимуму (8 GB / 15 GB). Требуется CI-машина владельца: ≥8 GB RAM (рекомендуется 12–16 GB), ≥15 GB диск (рекомендуется 25 GB), желательно swap 4–8 GB.
4. **Build result:** NOT RUN (запрещён в несоответствующей среде).
5. **Runtime result:** NOT RUN (нет BUILD PASS).
6. **F1–F6:** все шесть NOT RUN.
7. **Critical/high findings:** новых дефектов release candidate не обнаружено (объектная целостность полная). Infrastructure findings: снапшоттер-коммит `483e5a1` в HEAD (report-only, безопасен), drift-удаление 4 защищённых файлов в worktree (blobs целы, восстановимы), untracked-файлы старой эры (сохранены без изменений) — все задокументированы в A.3, ни одно не влияет на содержимое коммита.
8. **Final verdict:** **BLOCKED** (инфраструктура/ресурсы).
9. **Что осталось владельцу:** (1) передать bundle по безопасному каналу на CI-машину ≥8 GB RAM; (2) сверить SHA-256; (3) выполнить runbook `/home/z/conditera-release-CI-RUNBOOK.md` §4.1–4.9 (clone → frozen install → `bun run build` → `bun run db:setup` → `bun run start` → smoke F1–F6 → integrity); (4) вернуть фактические логи и статусы для финализации вердикта.
10. **Подтверждение отсутствия push/deploy:** push, merge, deploy, commit, `git add`, изменение кода/миграций/тестов/hooks — не выполнялись. Release candidate не перезаписан. История snapshotter сохранена. Production DB и production credentials не использовались.

**Останов. Ожидаю отдельного решения владельца. Успешная подготовка bundle не является разрешением на публикацию.**
