# CAKE STUDIO INTEGRATION GROUND TRUTH

**Тип документа:** forensic-аудит, READ-ONLY (никаких изменений кода/миграций/БД не выполнено)
**Дата аудита:** 2026-11-14 (Europe/Moscow)
**Рабочая копия:** `/home/z/my-project` (репозиторий `github.com/uezdtort-tech/conditera`)
**Метод:** 4 параллельных read-only аудит-агента (конструктор, рецептуры/разрез, чат, заказы) + ручная git/DB/env-фиксация + перекрёстные точечные проверки. Документы `docs/**`, `agent-ctx/**` использовались только как зацепки — каждое утверждение ниже проверено по коду (файл:строка) или git-объектам.

---

## 1. Сводный вердикт

| Вопрос | Ответ |
|---|---|
| Это Conditera? | Да — бренд «Уездный кондитер» в `src/lib/site-config.ts`; каталог, конструктор `/cake-builder`, маркеплейс рецептов |
| Цепочка конструктора прослежена? | Да, полностью (§4.1) |
| Чат прослежен? | Да (§4.3) — live-транспорт socket.io + HTTP, Supabase Realtime мёртв |
| Заказы прослежены? | Да (§4.4), включая immutable acceptance-snapshot |
| Рецептуры/разрез | Да (§4.2) — SVG-разрез строится из шаблонов, НЕ из рецептуры |
| Cake Studio V2 архив | **НЕ НАЙДЕН** в окружении → Шаг 6 задачи BLOCKED (§3.3) |
| Live-БД | **НЕ ИНИЦИАЛИЗИРОВАНА** (`.pgdata` отсутствует) → схема подтверждена по 85 миграциям (§3.2) |
| Mock vs production | Разделены и классифицированы (§5) |

---

## 2. Git Ground Truth (зафиксировано до начала работ; ничего не изменено)

### 2.1 Состояние

| Параметр | Значение |
|---|---|
| Репозиторий (toplevel) | `/home/z/my-project` (проверено `git rev-parse --show-toplevel`) |
| Ветка | `main` |
| HEAD | `01ea73d` — «8677bb44-89c2-4886-bada-be05481dc0ec» (UUID-snapshotter), 2026-11-14 14:32:30 +0000 |
| origin | `https://github.com/uezdtort-tech/conditera.git` |
| ahead/behind | **ahead 290 / behind 0** относительно `origin/main` |
| Tip origin/main | `8a31081` — 2026-11-04 20:58:51 +0000 (Merge PR #6 dependabot) — origin **сильно устарел**, локальная main — единственная актуальная история |

### 2.2 Рабочее дерево (до аудита = после аудита, кроме 5 новых отчётных .md)

```
 D src/app/api/services/upload/route.test.ts   (195 строк)
 D src/app/api/services/upload/route.ts        (87 строк)
 D src/app/api/upload/route.test.ts            (190 строк)
 D src/app/api/upload/route.ts                 (88 строк)
```

- Это **drift-удаление 4 защищённых маршрутов** (см. §2.3): файлы отсутствуют на диске, но блобы есть в HEAD (проверено: `git ls-tree -l HEAD -- src/app/api/upload src/app/api/services/upload` → деревья `a96cf99d`, `00250443`). **По условию задачи расхождение не исправлялось.**
- Никаких иных модификаций/добавлений в рабочем дереве до аудита не было. `git stash list` — пуст.

### 2.3 Защита путей и hooks

- `core.hooksPath = scripts/hooks`; `scripts/hooks/pre-commit` (1 строка) → `exec bash scripts/protected-paths.sh hook-guard`.
- `scripts/protected-paths.sh` — `MANDATORY_PATHS` (источник истины):
  1. `src/app/api/upload/route.ts`
  2. `src/app/api/upload/route.test.ts`
  3. `src/app/api/services/upload/route.ts`
  4. `src/app/api/services/upload/route.test.ts`
- Режимы: `repair` (ensure-dev.sh вызывает до старта сессии — **в аудите не запускался**), `skip-on` (skip-worktree), `hook-guard` (pre-commit восстанавливает блоб из последнего хорошего коммита).
- **skip-worktree: не установлен** ни на один файл (`git ls-files -v | rg '^[a-z]'` — пусто).
- Комментарий самого скрипта подтверждает класс инцидентов: процессы песочницы удаляют upload-роуты, UUID-snapshotter фиксирует удаление коммитом (371e975, eadd7d3, cd85b3e) или захватывает amend (fa3ca7e).

### 2.4 Происхождение и дата последнего подтверждённого обновления

| Событие | Факт |
|---|---|
| Последний **человеческий** подтверждённый коммит | `2cfa76b` — «Z-v33: release-документация — gate-артефакт, RELEASE_CANDIDATE, runbook, backlog, OS, release notes, production checklist», author 2026-11-13 12:02:18 +0000 |
| Reflog | reset: moving to `2cfa76b` в 2026-11-13 21:53:13; далее серия snapshotter-коммитов |
| UUID-snapshotter коммиты (платформенные, не ревьюились владельцем) | `483e5a1` (11-13 21:55), `49f86d4` (11-14 10:53, **amend** от `fed7798`), `0d86968`, `c0dca3f`, `727918a`, `0dc33d5`, `01ea73d` (11-14 14:32) |
| Судьба правок слогана из предыдущей сессии | **Поглощены snapshotter-коммитами в HEAD**: `git show HEAD:src/lib/site-config.ts:49` содержит «Уездный кондитер — от торта до сладкого стола» — проверено в этом аудите |
| `worklog.md` | 9322 строк; записей за 2026-11-13/14 нет — последнее журналирование старше HEAD |

**Вывод:** содержимое HEAD новее последнего человеческого коммита за счёт платформенных авто-коммитов; доверять стоит содержимому файлов в HEAD, а не сообщениям коммитов.

### 2.5 Ограничения, соблюдённые в аудите

Не выполнено ни одного: изменения файлов (кроме 5 новых отчётных .md в `docs/integration/`), коммита, переключения веток, reset/rebase, push/publish, изменения настроек Git/hooks, запуска миграций, записи в БД. `repair`/`skip-on` для защищённых путей не запускались (статус зафиксирован как есть). Каталог-карантин `/home/z/conditera-drift-quarantine-2026-11-14/` не открывался и исключён из поиска.

---

## 3. Окружение выполнения

### 3.1 Технологический стек (подтверждено по package.json + коду)

Next.js 16 App Router + TypeScript; Tailwind CSS + shadcn/ui; Zustand (`persist`, ключ `conditera-storage`) + TanStack Query; Supabase-клиент, но **через same-origin shim** (см. §4.0); socket.io mini-service (`mini-services/chat-server`, порт 3030); vitest + playwright; n8n-workflows (26 JSON); supabase/functions (Edge, Deno); bun-рантайм.

### 3.2 База данных — НЕ ИНИЦИАЛИЗИРОВАНА

- `node scripts/db/runtime.mjs status` → **«PostgreSQL: NOT INITIALIZED (no cluster at /home/z/my-project/.pgdata)»**.
- Встроенный PG сконфигурирован на `127.0.0.1:54329`, БД `conditera`, пользователь `postgres` (`scripts/db/runtime.mjs:43-46`).
- В режиме READ-ONLY кластер не создавался и миграции не запускались.
- **Следствие:** фактическая схема БД подтверждена по миграциям в HEAD — ровно **85 SQL-файлов** (`0001…0086`, файл `0073` отсутствует — см. INTEGRATION_GAPS_AND_RISKS R-13). Все утверждения о столбцах/RLS в приложенных документах снабжены ссылками на конкретные миграции. Применённость ledger (85/85) на этом кластере **не может быть подтверждена** — это пробел (§6, V-1).

### 3.3 Архив Cake Studio V2 — НЕ НАЙДЕН (BLOCKED)

Поиск по `/home` и `/tmp` (rg --files, glob *.zip/*.7z/*.rar, исключая node_modules/.pgdata/.git/.next и карантин):
- `/home/official_skills/*` — 65 skill-архивов платформы (не относятся);
- `/home/sync/upload/` и `/home/z/my-project/upload/` — только `conditera-resume-kit.zip`, `conditera-release-gate.zip/-v2/-v3`, `conditera-completion-v4.zip`;
- `conditera_cake_studio_v2.zip` — **0 совпадений** по всему дереву и по упоминаниям «Cake Studio» в репозитории (grep — 0 файлов).

**Следствие:** Шаг 6 задачи (сверка исходников архива, модули, Windows-зависимости) выполнен быть не может. В INTEGRATION_MAP все пункты, зависящие от формата V2, помечены `VERIFY/BLOCKED`. Для разблокировки: владелец передаёт архив (например, в `/home/z/my-project/upload/`), после чего аудит §6 выполняется отдельным read-only проходом.

### 3.4 Ресурсы

~3.9 GiB RAM / 0 swap / ограниченный диск — production build в этой среде ранее неоднократно упирался в лимиты; в рамках данного аудита сборки не выполнялись (и не требуются — код не менялся).

---

## 4. Архитектурная ground truth (кратко; детали в приложенных документах)

### 4.0 Критический транспортный факт: Supabase = same-origin shim

- Браузерный supabase-js ходит по `window.location.origin` (`src/lib/supabase/url.ts:39`) на `/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`, которые обслуживает **сам Next.js** (`src/app/rest/v1/[...path]/route.ts` — «PostgREST-совместимый шим»; `/auth/v1` shim; `/storage/v1` → файловая система `./upload/storage`).
- **`/realtime/v1` не существует** (grep realtime в next.config.ts/middleware.ts — 0) → все `supabase.channel(...)` подписки (use-chat.ts, use-cake-builder.ts, use-crm.ts) **недостижимы** в этом рантайме.
- Все чат-API используют `supabaseAdmin` (service-role) → **RLS для чата фактически отключена**, доступ проверяется в коде (`canAccessRoom`, `chat-rooms.ts:106-114`).
- Реалтайм живёт через socket.io (порт 3030) + HTTP-polling fallback (5 с / 15 с).

### 4.1 Конструктор (детали: CONDITERA_INTEGRATION_MAP)

- **Канонический живой путь:** `/cake-builder` (route) и SPA-вью `CakeBuilderPage` (`app/page.tsx:216-217`); `CakeBuilderDialog` смонтирован глобально, но его submit — **mock-only** (только zustand, ни сети, ни БД).
- Submit: черновик → `cake_builder_drafts` (браузер-клиент, RLS own-only) → `POST /api/inquiries` → 1 inquiry + N negotiations (≤5 кондитеров), 48-часовое окно; quote → `valid_until` 14 дней; accept → `converted` + сиблинги `declined`; checkout привязывает `negotiations.quoted_price` к цене заказа (`metadata.offerBinding`, `negotiations.order_id`, один заказ на оффер).
- Опции: productTypes/bases/coatings/decorations/dietary/shapes/tiers — **hardcoded mock** `CAKE_BUILDER_OPTIONS`; начинки — **DB `fillings`** (APPROVED, moderation 0020) с mock-fallback и **fail-closed** серверным слиянием (`builder-fillings-server.ts`).
- Расчёт цены: единственная изоморфная формула `cake-builder-pricing.ts`; серверная авторитетность — на checkout; tiers/shape из цены исключены, а их шаг 2.5 вообще недостижим (никто не ставит `step: 2.5`).
- Потери данных: `productType/tiers/shape/quantity/address` **не сохраняются** в `cake_builder_drafts`/`inquiries`; на accept→checkout восстанавливаются с hardcoded `productType:"cake"` (`offer-format.ts:162-176`).
- Legacy: `/api/quotes` (`quote_requests`/`confectioner_quotes`) — параллельный контур без accept-эндпоинта и с багом единиц (рубли vs копейки).
- `checkout/confectioner-assignment.ts` — **мёртв** → кастомные заказы уходят с `confectioner_id=null`.

### 4.2 Рецептуры и разрез

- Нормализованный контур: `recipes` (author_id → auth.users) → `recipe_steps`/`recipe_ingredients`/`recipe_media`/`recipe_variants`/`recipe_sources`; publish → **иммутабельные `recipe_versions`** (snapshot JSONB, service_role-only); коммерция — `recipe_marketplace` + `recipe_purchases` (entitlement, recipe_version_id); производство — `recipe_production_cards` (+versions, batches, cost history), pin `recipe_version_id` на approve.
- Приватность: RLS автор-скоупед; **но** `recipe_ingredients` — `USING(true)` для всех authenticated (0053:150-153, «сужение отложено в несуществующую миграцию 0073» — 0065:93) → латентный over-read.
- **Визуализация разреза — НЕ из рецептуры:** `SliceSVG` рисует 5 hardcoded PRESETS по подстроке в названии начинки (`cake-slice-visualizer.tsx:116-124`); путь A (реальные данные) — только загруженное фото `product_slices.image`; путь B — шаблон по имени (`detectPreset`, `generateConfigFromName`, `cake-visual-map.ts` с палитрой по mock-id); путь C — AI (`/api/fillings/ai-generate-slice` через LLM, `/api/products/ai-photo` со stock-fallback Unsplash). `fillings.slice_image/slice_config` (0043) используются только в редакторе кондитера.
- Снапшот производства: `orders.metadata.acceptance_snapshot` (schema_version=1, recipe_version_id **всегда null** — «резерв под вариант B/C», snapshot.ts:439-440) строится серверно **в том же INSERT**, что и заказ, fail-closed, MVCC одним стейтментом; читается breakdown/acceptance/`apply_order_write_off_atomic` (0081).

### 4.3 Чат

- Таблицы: `chat_channels` (type TEXT: direct/group/support/negotiation; `negotiation_id` FK существует, **но ни один код-путь его не пишет**; `order_id` + partial UNIQUE — ровно один живой чат на заказ), `chat_channel_members`, `chat_messages` (text; `attachments JSONB` — зарезервировано, **не используется**; `metadata JSONB`; `is_bot`+`bot_kind` ∈ faq/escalation/welcome/order_status/payment_reminder; `idempotency_key` UNIQUE; **колонки message_type НЕ существует**).
- Вложения не реализованы (явный комментарий в `chat-widget.tsx:57-61`); голос — локальный blob-демо (микрофон заблокирован Permissions-Policy); upload-инфраструктура `/api/upload` → бакет `media` (файл удалён drift'ом, блоб в HEAD).
- Связи: заказ-чат через `ensureOrderChatChannel` (обе стороны + actor), direct через `resolveDirectPeer` (confectionerId → confectioners.userId), support — переиспользование последней открытой комнаты.
- Боты: socket FAQ-бот (персист через `/api/chat/rooms/:id/bot-message` с x-bot-secret), `chat-automation.ts` (welcome/статусы/напоминания из webhook и cron), эскалации → операторская консоль. Dormant: `/api/chat/auto-reply`, `bot-trigger`, faq-embeddings, legacy `chat_rooms`.
- **Структурированное сообщение Cake Design — FEASIBLE** без нового чата: ~8 точек касания, главный риск — белый список полей в socket-сервере (`chat-server/index.ts:721-734`) обрежет неизвестный payload (см. BACKLOG B-16).

### 4.4 Заказы

- `orders` (enum `order_status` 10 значений; `payment_status` 7 значений; суммы в рублях; metadata: acceptance_snapshot, idempotency_key, offerBinding), `order_items` (двойной набор колонок 0002 vs 0040; `selected_attributes` = полный CakeBuilderConfig для кастомных позиций), `order_status_history` (триггер снят 0061, пишет только приложение), `order_media` (0054; `kind` — **free text**, дефолт `ready_photo`; `media_type` CHECK 'photo'; хранение — ФС `orders/<id>/published/photos/`), payments/refunds/payout_requests, capacity-контур 0054, `domain_events`+`audit_log`+`order_status_history` — трёхслойный аудит.
- Lifecycle: **две матрицы переходов** — legacy PATCH `/api/orders/[id]` и superset-движок `src/lib/ops/lifecycle.ts` (CAS, QC-gate с обязательным фото для cakes/bento, события). Деньги: webhook → `payment_status='escrow'` (CAS), релиз cron 24 ч через `release_escrow_order` (0037); параллельная legacy-модель `escrow_accounts` (триггер 7 дней) — не в живом пути; Edge Function yookassa-webhook — расходящийся заглушечный дубль (VERIFY).
- **Immutable approved-design snapshot — FEASIBLE**: якорь №1 — `order_media.kind` (новое значение, ноль миграций) + подкаталог `designs/`; якорь №2 — новая 1:1 таблица по образцу `order_production` (0054) если нужна DB-иммутабельность; `orders.metadata` для этого **не годится** (RLS `orders_update_own` позволяет покупателю UPDATE строки).

---

## 5. Mock vs Production (консолидировано)

| Контур | Production | Mock/legacy |
|---|---|---|
| Конструктор | CakeBuilderPage, /api/inquiries, /api/negotiations/[id], checkout binding, fillings DB (fail-closed) | CakeBuilderDialog (mock submit), CAKE_BUILDER_OPTIONS (hardcoded), /api/quotes (legacy, units bug), MOCK_CONFECTIONERS в store до hydrate |
| Рецептуры | recipes root + versions + entitlement + production cards | `recipe_marketplace.steps_json` (frozen JSONB legacy), store.demoSeed(MOCK_RECIPES) |
| Разрез | product_slices.image (реальные фото) | detectPreset/generateConfigFromName/cake-visual-map (шаблоны), AI-генерация (маркирована) |
| Чат | chat-widget → /api/chat/* + socket.io + polling; боты; эскалации | use-chat.ts/use-cake-builder.ts realtime (dead), MOCK_CHAT_ROOMS r1/r2/r3 (r3 → реальный support), chat-faq-embeddings (dormant) |
| Заказы | /api/checkout (idempotent), /api/orders, payment/webhook, escrow-release cron, ops/lifecycle.ts | MOCK_ORDERS в store; use-real-orders fallback к mock с флагом isStale; escrow_accounts+0011 триггер; Edge Function yookassa-webhook |
| AI-виджеты | ai-dialogue engine (шаблоны + LLM fallback) | ai-builder-assistant (dead keyword-mock), ai-assistant-widget (отдельная инфраструктура) |

---

## 6. Консолидированный VERIFY-список (недостаточно доказательств в этом окружении)

| ID | Предмет | Причина |
|---|---|---|
| V-1 | Применённость миграций на живом кластере (ledger 85/85) | БД не инициализирована; запуск = нарушение READ-ONLY |
| V-2 | Cake Studio V2: модули, Windows-зависимости, формат Cake Project | Архив отсутствует в окружении |
| V-3 | Реальные столбцы `fillings` (seed пишет несуществующие slug/color/suggested_price_modifier) | Нет live-БД; на migration-only схеме seed упадёт |
| V-4 | RLS/grants для `product_slices` (политик нет ни в одной миграции) | Неясна фактическая доступность через PostgREST |
| V-5 | Куда реально указывает webhook YooKassa (API route vs Edge Function-заглушка) | Внешняя конфигурация мерчанта |
| V-6 | n8n 13-order-processing ждёт `autoApproveEligible=1` (параметр не реализован) | Нет живого n8n-инстанса для проверки |
| V-7 | Запись `payment_status='failed'` (не в enum) в POST /api/orders на бонус-фейле | Нужен runtime-тест |
| V-8 | Монтирование `use-escrow.ts` (service-role клиент в браузерном файле) | Не найдено точек монтирования |
| V-9 | Записывается ли `uploads`-реестр (0015) кем-либо кроме удалённого /api/upload | Дрейф-удалённый маршрут — блоб в HEAD не пишет реестр |
| V-10 | Наличие seed-строк `cake_builder_options`/`builder_config` в живой БД | БД не инициализирована |
| V-11 | Достижим ли шаг 8 конструктора с чисто mock-кондитерами на всех поверхностях (марки ConfectionersMarquee) | Требуется runtime-прогон |

---

## 7. Приложенные документы

1. `CAKE_STUDIO_INTEGRATION_GROUND_TRUTH.md` (этот документ)
2. `CAKE_PROJECT_DATA_MODEL_PROPOSAL.md` — предложение модели Cake Project Core
3. `CONDITERA_INTEGRATION_MAP.md` — карта REUSE/ADAPT/REPLACE/NEW/VERIFY
4. `INTEGRATION_GAPS_AND_RISKS.md` — пробелы и реестр рисков
5. `IMPLEMENTATION_BACKLOG.md` — пакеты работ с зависимостями и критериями приёмки
