# Release Gate v4.3 — ЗАКРЫТИЕ ВНЕШНИХ БЛОКЕРОВ

Дата: 2026-10-16 (UTC). Сессия: «v4.3 external blockers» (worklog Task H-1).
Публикация/push/PR/изменение защиты ветки/deployment: **НЕ выполнялись** (прямое требование v4.3).

---

## 0. Фактическое состояние (проверено в этой сессии, не взято из отчёта v4.2)

| Параметр | Значение |
|---|---|
| HEAD на старте сессии | `7dcc09d975c15f2a9cfc46eae87afb0ffa513797` (совпал с заявленным в v4.3) |
| `origin/main` (`git ls-remote`, повторно в конце сессии) | `8454b3ae249801effb6a699abb6633db164a219b` — кандидат по-прежнему не опубликован |
| Ahead / behind (финал сессии) | **73 / 0** (71 на старте + 2 коммита этой сессии, §5) |
| Дерево | чистое (0 изменённых файлов после коммитов) |
| Коммиты сессии | `bdf2ec9` (U-06 верификатор+evidence), `3d9a7f8` (E2E exact-status+evidence) |

**Коммиты v4.2 `22fbb8c`/`299afb4`** повторно не аудировались детально — установлено выше
(v4.2 §1) и подтверждено diff-классификацией: 0 исполняемого кода (docs/evidence/worklog only).

**Привязка production-бандла к кандидату.** `.next/BUILD_ID` собран на `12c8815`
(mtime 15:12Z). `git diff --name-only 12c8815..HEAD -- src/ next.config.ts package.json
scripts/db/ supabase/migrations/ prisma/` = **ровно 2 файла, оба vitest-тесты**
(`route.test.ts`, `product-page.slice-photos.test.tsx`) — в бандл не входят.
→ Бандл валиден для HEAD `3d9a7f8`; все живые проверки сессии выполнялись на нём.

---

## 1. DEV-01 — U-06: реальные срезы тортов

### 1.1 Изучение механики (v4.3 п.1) — выполнено, подтверждено

- `supabase/seed_slices.template.sql` — шаблон владельца с плейсхолдерами
  `__FILLING_N__/__SLICE_PHOTO_N__/__CAPTION_N__` для 3 флагманов;
  **не включён** в автоприменение (0 ссылок в `scripts/db/setup.mjs`,
  `supabase/init-scripts/01-apply-migrations.sh`) — проверено grep'ом.
- Схема `product_slices` (миграция `0017_sync_missing_tables.sql:281`): `{id TEXT PK,
  productId, fillingName, image, config JSONB, caption, sortOrder}` + индексы
  `productId`/`fillingName`. Каталог `fillings.slice_image` (0043) — альтернативный
  канальный уровень, заполнен у **0** строк.
- Редактор срезов в дашборде кондитера существует и проводен:
  `src/components/dashboard/confectioner-slice-editor-tab.tsx`
  (вкладки fillings/products, `csrfFetch`, `CakeSliceVisualizer`; проводка
  `confectioner-dashboard.tsx:1135`). Рабочий процесс наполнения: загрузка фото
  через `POST /api/upload` (≤10 МиБ, PNG/JPG) → URL → запись среза.

### 1.2 Три приоритетных продукта (v4.3 п.2) — ID из БД, главные фото реальные

| ID | Продукт | Главное фото (в БД и на диске) | Требуемые материалы |
|---|---|---|---|
| `aaaaaaaa-0000-4000-8000-000000000001` | Свадебный торт «Ягодный бархат» | `/uploads/products/svadebnyy-tort-yagodnyy-barhat.png` ✓ | fillings (2–3 шт.) + по 1 фото разреза на каждую + caption |
| `aaaaaaaa-0000-4000-8000-000000000002` | Домашний «Наполеон» | `/uploads/products/tort-napoleon-domashniy.png` ✓ | fillings (1–2 шт.) + фото разреза + caption |
| `aaaaaaaa-0000-4000-8000-00000000000b` | Порционные десерты (20 шт.) | `/uploads/products/deserty-portionnyye-20.png` ✓ | fillings (1–2 шт.) + фото разреза + caption |

### 1.3 Проверка наличия контента (v4.3 п.3–4) — контента НЕТ, точный список владельцу

SQL-факт (свежий прогон в этой сессии, embedded PG `54329/conditera`):
`product_slices = 0 строк`; продуктов с непустым `products.fillings` = **0**;
каталог `fillings` = 45 строк, но `slice_image` заполнен у **0**;
`public/uploads/fillings/` = **0 файлов** (все 12 фото — главные фото продуктов).

**Точный список недостающих материалов владельцу** (минимальный витринный набор,
детали и готовый SQL — в `supabase/seed_slices.template.sql`, чек-лист внутри файла):
1. Начинки для 3 флагманов: названия (строго из каталога `fillings`, 45 позиций),
   наценки `priceModifier` — текстом владельцу в файл/дашборд.
2. По **1 реальному фото разреза на КАЖДУЮ начинку** этих продуктов
   (PNG/JPG, ≤10 МиБ, вертикальный/квадратный кадр) — суммарно ≈4–7 фото.
3. Подпись (caption) к каждому фото — фактический состав слоёв.
4. Канал передачи: дашборд кондитера (вкладка «Срезы») ИЛИ `POST /api/upload` +
   заполнение `seed_slices.template.sql` ИЛИ `POST /api/products/<id>/slices`.

Фиктивные production-URL не создавались; template SQL в автоприменение не
включался; production-каталог не менялся (v4.3 п.5 соблюдены).

### 1.4 Живая проверка трёх состояний (v4.3 п.6) — PASS 21/21 с DOM-доказательствами

Исполнитель: `scripts/verify/u06-three-state-live.mjs` (НОВЫЙ, коммит `bdf2ec9`) на
prod-бандле (валидность — §0), продукт …0002 «Домашний „Наполеон"». Временные строки
помечены `[TEMP-U06]`, image — **реальные ассеты репо** (проверка файла на диске),
после проверки БД восстановлена байт-в-байт (`fillings='[]'`, `product_slices=0`).

| Состояние | API | DOM (браузер, Playwright) | Скриншот |
|---|---|---|---|
| A: нет разреза | card `fillings=[]`, `/slices=[]` | секции «Срезы торта по начинкам» **нет** (0); главное фото `<img>` `naturalWidth>0` | `stateA-no-slices.png` |
| B: один разрез | card 1 filling; `/slices` 1 шт. `image=IMG_1`, `sortOrder=0` | секция есть (1); `<img alt="[TEMP-U06] Ванильный крем (проверка)">` загружено; главное фото на месте | `stateB-one-slice.png` |
| C: два разреза | card 2 fillings; `/slices` 2 шт., порядок `sortOrder asc` | секция есть; **оба** `<img>` загружены, alt'ы = обе начинки в порядке | `stateC-two-slices.png` |

Итог: `SUMMARY pass=21/21 fail=0` — evidence
`docs/evidence/release-gate/v43-u06-threestate-7dcc09d.log` + 4 скриншота
в `docs/evidence/u06-v43/`. Инфраструктурное наблюдение: dev-сервер (Turbopack)
в песочнице убивается OOM-киллером (3.0 GB RSS при лимите 4 GB — зафиксировано в
шапке `scripts/e2e-one.sh`), поэтому живые проверки выполнялись на prod-бандле
(мгновенная отдача маршрутов) — тот же режим, что и штатный E2E-раннер.

### 1.5 Матрица U-06 (v4.3: раздельные статусы)

| Компонент | Статус | Обоснование |
|---|---|---|
| Техническая передача (БД → API → карточка) | **PASS** | Три состояния live на prod-бандле: гейт `fillings>0`, GET `/slices` `sortOrder asc`, строгий матч `fillingName` — всё подтверждено API-пробами и юнит-регрессией v4.2 (050e128) |
| UI (главное фото, фото среза, отсутствие чужих URL) | **PASS** | DOM-доказательства: главное фото загружено в A/B/C; фото среза загружено в B (1 шт.) и C (2 шт.); в A секции нет — фолбэк корректен; alt = fillingName |
| Наличие реального контента | **ОТСУТСТВУЕТ** | §1.3: 0 срезов, 0 fillings, 0 slice_image, 0 файлов в uploads/fillings — реальных фотографий разрезов не существует |
| Production-приёмка U-06 | **BLOCKED (владелец)** | Ждёт материалы по §1.3; после наполнения — повторить позитив на живых данных |

**Итог U-06: НЕ PASS** — механика доказана полностью (21/21), контента нет,
владелец имеет точный чек-лист. Продуктовая приёмка невозможна без его материалов.

---

## 2. DEV-02 — production auth

### 2.1 Контракт и фактическая конфигурация (v4.3 п.1–2)

Документированный контракт: `docs/AUTH.md` (dual-stack: канон Supabase
`getCurrentUser()` + legacy JWT, machine-to-machine через shared secrets);
`docs/API_AUTH_MATRIX.md`, `docs/ROLE_MATRIX.md`. Fail-closed-контракт health:
`8cbf9c6` (prod: configured+unreachable → `degraded`, HTTP 200).

Таблица обязательных переменных (presence-only, **значения не печатались**):

| Переменная | Назначение | `.env.production.example` (63 ключа) | Текущая песочница |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Kong/self-hosted или cloud URL | есть (USER-MUST-FILL) | `.env.local`: SET (len=21) — локальный runtime |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Kong apikey | есть | SET (len=165) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side admin | есть | SET (len=176) |
| `JWT_SECRET` | legacy JWT access | есть | SET (len=96) |
| `JWT_REFRESH_SECRET` | legacy refresh (НЕ копия) | есть | SET (len=96) |
| `GOTRUE_PROBE_TIMEOUT_MS` | опц. таймаут пробы (дефолт 3 s) | — (опциональна) | ABSENT (дефолт) |

Верификатор контракта: `node scripts/verify/production-env-template.mjs` →
**exit 0** («все required-переменные присутствуют в шаблоне»; compose: 6 required).

### 2.2 Интеграционные проверки (v4.3 п.3) — выполнены на живом сервере

- **Регистрация → вход → восстановление сессии**: E2E `integration-auth-flow`
  (`E2E_SERVER_MODE=dev`, живой локальный провайдер, HEAD `7dcc09d`) —
  **17 / 0 unexpected / 0 flaky / 0 skipped, EXIT=0**. Покрытие по шагам:
  register (пользователь+токены) → login → **refresh-токен → новый access
  (восстановление сессии, точный ассерт 200)** → 2FA setup → health → CSRF
  (точный 403) → rate-limit → публичные маршруты.
  Evidence: `v43-auth-iaf-7dcc09d.log` + JSON `e2e-v43/integration-auth-flow.dev.7dcc09d.json`.
- **Отказ при некорректной конфигурации (fail-closed)** — регрессии зелёные:
  `register/route.test.ts` + `health/route.test.ts` = **14 passed** (prod+authErr →
  500 ДО любых записей; prod unreachable → `degraded`; anti-false-positive для dev).
  Плюс живое подтверждение: register-валидация в prod-режиме вернула 400/422/429,
  никогда 500 (прогон auth-flow в prod, §3.4).
- CSRF/роли/токены не ослаблялись: 0 diff по auth-роутам в сессии (изменены
  только тестовые контракты, §3.4).

### 2.3 OWNER DECISION — топология реального провайдера (v4.3 п.4)

Провайдер production не определён владельцем → **решение за владельцем**,
выбор за ним; fail-closed не ослабляется ни при каком выборе. Параметры:
реальный `SUPABASE_URL` (+ Kong `/auth/v1/*`), сервисный ключ в `.env.production`
(не в репо), опц. `GOTRUE_PROBE_TIMEOUT_MS` если латентность > 3 s.
Проверяемые сценарии после настройки: (1) `GET {SUPABASE_URL}/auth/v1/health` с
apikey → 2xx ≤ таймаута; (2) `/api/health` в проде → `auth:"ok"`, `status:"ok"`;
(3) регистрация реального пользователя (201, запись в `auth.users`, профиль/роль);
(4) вход + сессия + защищённый маршрут.

Dev-провайдер (embedded PG, auth.users stub) **не** засчитывается как production-приёмка —
сознательно зафиксировано в evidence-логе.

---

## 3. DEV-03 — кандидат, PR и GitHub Actions

### 3.1 Состав кандидата (v4.3 п.1–2)

71→73 коммита впереди `origin/main=8454b3a`; diff: 223 файла, +37978/−477.
Классификация коммитов: docs(worklog)×11, fix(chat-server)×6, ops(evidence)×5,
test×8, fix(e2e/courier/docker)×6, ci(e2e)×2, docs(release/auth)×5, ops×9, feat×N
(health/checkout/PostgREST shim/U-06 и др. — полный список `git log origin/main..HEAD`).

**Критические классы в diff (v4.3 п.2):**

| Класс | Файлы в diff | Обоснование |
|---|---|---|
| Финансовая логика (checkout/payments/webhooks/escrow/payout/refund/balances) | **0 файлов** | Жёсткое правило всех версий соблюдено; U-07 исправлен client-only (87fe425, сервер 0 diff — подтверждено diff) |
| Миграции (`supabase/migrations/`) | **0 файлов** | 59 миграций идентичны origin/main (включая 0060 `uq_orders_idempotency` — он УЖЕ был в origin/main, проверено `git cat-file`) |
| Workflows | `ci.yml`, `e2e.yml` | Chromium-only матрица (решение владельца variant B), безопасная передача dispatch-инпута через env, DB bootstrap — см. §3.3 |
| Конфигурация | `Dockerfile`, `Dockerfile.chat`, `Dockerfile.simplex-bridge`, `docker-compose.yml`, `next.config.ts` | Simplex-bridge non-root (7bcf817), health-префлайт GoTrue (8cbf9c6) — решения v4.0–v4.2 с записями в worklog/отчётах |
| Upload-маршруты | оба на месте, отслеживаются, тесты сохранены | `src/app/api/upload/route.ts`, `src/app/api/services/upload/route.ts` (повторно проверено v4.2 §1; 0 diff в этой сессии) |

### 3.2 Тесты не маскируют сбои (v4.3 п.4) — НАЙДЕНО И ИСПРАВЛЕНО (коммит `3d9a7f8`)

Аудит 9 E2E-спеков нашёл допущения неожиданных статусов; **исправлены тестовые
контракты** (код приложения 0 diff):

- `/api/products`: `[200, 500]` → **точный 200** (smoke + full-flow) — БД
  гарантирована bootstrap'ом (workflow `db:setup` :154 / e2e-one.sh), 500 = реальный сбой;
- `/api/auth/session` без авторизации: `[401, 307, 200, 500]` → **точный 200**
  (документированный контракт `200 + {user:null}`, session/route.ts; живое подтверждение);
- `/api/health`, `/api/csrf-token`, `robots.txt`, `sitemap.xml`: `ok()` → точный 200;
- register/login валидация: 500 исключён из допустимых (валидация до БД;
  429 anti-fraud вариантность задокументирована и сохранена).

Прогон на prod-бандле: **smoke 11/0, full-flow 36/0, auth-flow 14/0 — все EXIT=0**.
Оставлено как есть (задокументированная security-вариантность, НЕ маскировка):
webhook-спек `[200,401,404,500]` (401 = prod allowlist P0/PAY-1; 404 = order вне
тестовой БД) и `[400,500]` на невалидный JSON — payment-смежные контракты перед
публикацией сознательно не тронуты; при желании владелец может потребовать ужесточения.

### 3.3 E2E workflow на кандидате (v4.3 п.3) — все пункты подтверждены с номерами строк

- **Chromium-only**: `e2e.yml:138` `browser: ["chromium"]` (variant B, решение владельца);
- **Безопасная передача grep**: `:209` `E2E_GREP: ${{ github.event.inputs.grep }}`
  через env; `:196–198` расширение внутри bash-массива; текстовых `${{ }}`
  подстановок dispatch-инпута в команды нет;
- **DB bootstrap**: `:152–156` `node scripts/db/runtime.mjs start` + `bun run db:setup`;
- **Readiness-check**: `:168–181` `bun run start &` + поллинг `/api/health`
  (30×2 s, grep 200);
- **Согласованный localhost**: сервер `-H 0.0.0.0`, цель тестов
  `E2E_BASE_URL: http://127.0.0.1:3000` (`:206`, с обоснованием ::1 в комментарии).
  Наблюдение (не дефект): `NEXT_PUBLIC_APP_URL: "http://localhost:3000"` (`:77`) —
  это URL для ссылок приложения, не цель тестов; на согласованность цели не влияет.

### 3.4 Точный шаг публикации (выполняет ВЛАДЕЛЕЦ; без разрешения — ничего не публикуется)

1. `git branch release-candidate-v43 3d9a7f8` (или более новый финальный SHA из §5)
   → `git push -u origin release-candidate-v43`;
2. открыть PR `release-candidate-v43` → `main` (НЕ прямой push 73 коммитов);
   CI (`ci.yml`) + ручной `e2e.yml` (workflow_dispatch, при желании с E2E_GREP)
   запустятся на head-SHA ветки = **точный SHA кандидата** — URL прогона
   зафиксировать рядом с этим отчётом;
3. после зелёного CI на точном SHA — merge по явному решению владельца;
4. защита `main` (применяет владелец): Settings→Branches: require PR, ≥1 approval,
   required checks `lint-and-typecheck`, `vitest`, `build` (jobs `ci.yml`), `e2e`
   как non-required до стабилизации.

---

## 4. DEV-04 — обязательные удалённые проверки (после разрешённой публикации)

| Проверка | Статус | Основание |
|---|---|---|
| CI на опубликованном SHA | **BLOCKED (владелец)** | Кандидат не опубликован (`ls-remote` дважды в сессии → `8454b3a`); прогон CI возможен только после §3.4 |
| Защита main + обязательные статусы | **BLOCKED (владелец)** | То же + GitHub API rate-limit из песочницы (наблюдение владельца `protected: false` остаётся открытым) |
| Docker: Compose config → 3 сборки → inspect → секрет-гейт | **BLOCKED** | Движка нет: `command -v docker/compose/podman` пусто, `/var/run/docker.sock` отсутствует, systemd не активен — evidence `v43-docker-engine-check-3d9a7f8.txt`. Статический просмотр НЕ засчитывается (v4.3 п.: «BLOCKED, а не PASS») |

Командный набор для среды владельца — без изменений: `RELEASE-GATE-v4.1-REPORT.md` §6
(compose config/build web+chat+simplex/inspect ×3/`docker history` grep по секретам/
smoke `up -d`+health/чек-лист T1–T6 non-root).

---

## 5. Коммиты этой сессии

| SHA | Содержимое |
|---|---|
| `bdf2ec9` | test(u06): живой трёх-состояний верификатор + 4 скриншота + лог (21/21 PASS) |
| `3d9a7f8` | test(e2e): точные статус-контракты (анти-маскировка) + 4 JSON-артефакта + 2 гейт-лога |
| (финальный) | `RELEASE-GATE-v4.3-REPORT.md` + worklog-аппенд (docs-only) |

Гейты на финальном дереве: lint 0; скан-evidence exit 0 (real 0 / 302 синтетик);
env-template exit 0; IAF 17/0; smoke 11/0; full-flow 36/0; auth-flow 14/0;
fail-closed регрессии 14 passed; U-06 three-state 21/21. Полный vitest/ build не
перепрогонялись: 0 изменений app-исходников в сессии (только тесты/доки/verifier),
бандл валиден для HEAD (§0), витрина 50 файлов/1014 тестов на идентичных исходниках — v4.2 §1/§6.

---

## 6. Открытые риски (реестр, без изменений по существу)

1. Контент fillings/slices отсутствует — чек-лист §1.3 (`seed_slices.template.sql`).
2. U-06 позитив на реальном контенте — после п.1.
3. Реальный GoTrue-провайдер — OWNER DECISION (§2.3).
4. Удалённый CI на кандидате — после публикации (§3.4).
5. Защита main `protected: false` — рекомендации §3.4, применяет владелец.
6. Docker-гейт T1–T6 — среда владельца (§4).
7. Webhook-спек допущения `[…500]` — задокументированы §3.2, ужесточение по решению владельца.
8. Keyless checkout (opt-in), дубль тикета при повторном POST, checkout 200-vs-201 — решения владельца (без изменений с v4.2).
9. Firefox/WebKit E2E отключены (variant B) — будущее решение владельца.

---

## 7. Заключение

**READY FOR OWNER REVIEW.**

Все локальные проверки v4.3 выполнены на фактическом дереве с привязкой к SHA:
механика U-06 доказана живо в трёх состояниях (21/21, DOM+скриншоты, честное
«контента нет»); auth разделён на «работает в приложении (17/17 + fail-closed
14/14)» и «OWNER DECISION по топологии провайдера»; тестовые маскировки статусов
найдены и устранены (3 спека зелёные на точных контрактах); workflow/дифф/миграции/
финансовые файлы проверены построчно; путь публикации и Docker-команды подготовлены
до шага. Исполняемое приложение не менялось (0 diff app-исходников).

**PRODUCTION-READY не выставляется** — до публикации кандидата (§3.4), зелёного CI
на точном опубликованном SHA, реального Docker-гейта (§4) и подтверждения
топологии auth-провайдера (§2.3).
