# Z-v29 — RECIPE SNAPSHOT IMPLEMENTATION & HISTORICAL ORDER CONSISTENCY

Дата: 2026-11-11. Репозиторий: `uezdtort-tech/conditera` (локально, публикация не выполнялась).
Предыдущий этап: Z-v28 (`docs/audits/ZV28_POST_V27_FORENSIC_AUDIT.md`, §9.5 — план варианта A).

---

## 1. Исходная проблема

Товарный заказ не фиксирует состав рецепта. `order_items` снапшотит только
коммерческие поля (title/price/qty/attributes — `supabase/migrations/0002_marketplace.sql:224+`),
а потребность в ингредиентах при каждом разборе/приёмке вычисляется по
ТЕКУЩЕМУ рецепту (`order_items → products.recipe_id → recipe_ingredients`,
`src/lib/ops/breakdown.ts`, `src/lib/ops/acceptance.ts`).

Следствие (подтверждено Z-v27/Z-v28): правка рецепта после оформления заказа
задним числом меняет потребность/дефицит/закупку исторического заказа; accept
оплаченного заказа может отклониться (409 `canProduce=false`). Механизм
`recipe_versions` существует, но его вызывают только контуры публикации
рецептов маркетплейса (`src/lib/recipes/publish-core.ts`) — товарный путь
`products.recipe_id` версии не фиксирует; партийный контур версионирован
отдельно (`recipe_production_card_versions`, миграция 0070).

## 2. Архитектура до изменений

- **Checkout** (`POST /api/checkout`): гейт `checkAcceptance` (гипотетический, live),
  затем INSERT `orders` (metadata: cart_items/idempotency_key/contact) → INSERT
  `order_items` → платёж. Состав рецепта не записывается.
- **B2B** (`POST /api/orders`): то же, metadata только `items_count`.
- **Acceptance** (`checkOrderAcceptance` → `loadOrderItemsData`): JOIN на
  текущие products/recipes → `computeIngredientNeeds` читает текущие
  `recipe_ingredients`; склад сопоставляется по `inventory_item_id`/имени.
- **Breakdown/purchase-draft**: тот же live-расчёт (`computeOrderBreakdown`).
- **Списание** (`/api/inventory/write-off`, order-путь): количества задаёт
  кондитер, идемпотентность — реестр `inventory_write_offs` по
  (owner, order, signature) (миграции 0048/0049); рецепт не читается.
  Партийный путь (0071) валидирует по неизменяемому snapshot карты.
- **`orders.metadata JSONB`** существует (0002:204); ни один код-путь не
  обновляет metadata существующего заказа (проверено grep по всем
  `.from("orders").update`).

## 3. Выбранная модель snapshot

Вариант A из Z-v28 §9.5, реализованный с тремя обоснованными уточнениями:

1. **Per-product структура, а не pre-агрегат**: snapshot хранит по одной
   позиции на `product_id` (строки корзины одного товара агрегируются по
   quantity) с нормами НА 1 ЕДИНИЦУ. Это даёт устойчивую привязку к
   order_items (проверка покрытия), защиту от подмены чужим товаром и
   повторное использование той же агрегации/сопоставления, что и live-путь.
2. **Производственные нормативы зафиксированы вместе с нормами**
   (`production_time_hours`, `prep/cook_time_minutes`, `category_slug`) —
   они реально используются приёмкой (`estimateOrderProductionMinutes`);
   без этого правка рецепта по-прежнему меняла бы срок/мощность
   исторического заказа.
3. **Fail-closed для повреждённого snapshot** (блокирующий код
   `SNAPSHOT_INVALID`): заказ, У КОТОРОГО есть snapshot, но он повреждён/
   частичен/чужой — блокируется, а не «молчаливо» считается по текущему
   рецепту. Отсутствие snapshot (легаси) — не ошибка: live-расчёт с явным
   флагом `need_source="live"`.

## 4. Обоснование места хранения

`orders.metadata.acceptance_snapshot` (JSONB, без DDL):

- колонка существует — нулевая миграционная сложность и нулевой риск для
  80 применённых миграций;
- snapshot живёт в самой строке заказа → запись атомарна с созданием
  заказа (один INSERT), нет второй сущности, рассинхронизация невозможна;
- обратная совместимость: заказы без ключа ведут себя как раньше;
- защита от «незаметной подмены» обеспечивается серверной сборкой +
  строгой валидацией при чтении (`readAcceptanceSnapshot`) + проверкой
  покрытия (`validateSnapshotCoversOrder`), а не схемой БД.

Ограничение (сознательное): нет FK-целостности состава (свойство JSONB).
Полноценное версионирование рецептов товаров (вариант B/C Z-v28) остаётся
путём эволюции — в snapshot зарезервировано поле `recipe_version_id`.

## 5. Точка фиксации snapshot

- **Момент**: сборка из БД непосредственно перед INSERT заказа; snapshot
  попадает В ТОТ ЖЕ INSERT (`metadata.acceptance_snapshot`) — фиксация
  атомарна с созданием заказа.
- **checkout** (`src/app/api/checkout/route.ts`, шаг 4b): после гейта
  acceptance/промо/доставки, до INSERT. Ошибка сборки → 503 ДО создания
  заказа (fail-closed: недопустима оплата без производственного снимка).
- **B2B** (`src/app/api/orders/route.ts`, шаг 8.5): тот же контракт,
  `source="orders_b2b"`.
- **Не создаются конфликтующие версии**: replay по Idempotency-Key
  возвращает существующий заказ (новый snapshot не собирается); гонка двух
  параллельных POST разрешается уникальным индексом 0060 — проигравший
  делает replay, ничего не перезаписывая.
- **Клиент не влияет на состав**: тело запроса не содержит поля snapshot
  (Zod-схема лишние ключи отбрасывает); нормы читаются сервером из БД.
- **Иммутабельность после фиксации**: ни один код-путь не выполняет
  `orders.update` с metadata (проверено Z-v29 по всем вызовам); webhook
  платежа меняет только status/payment_status.

## 6. Изменённые компоненты checkout

`src/app/api/checkout/route.ts`: импорт `buildAcceptanceSnapshot`; шаг 4b —
сборка snapshot для товарных позиций (custom-позиции конструктора без
product_id в snapshot не входят — у них нет рецептов, прежняя семантика);
включение в `metadata` при INSERT.

## 7. Изменённые компоненты acceptance

`src/lib/ops/acceptance.ts`:

- `loadOrderItemsData`: читает `o.metadata`; валидный snapshot → нормы,
  recipe_id и производственные параметры позиций берутся ИЗ СНИМКА
  (`needSource="snapshot"`); повреждённый → `snapshotError` (fail-closed);
  отсутствующий → live (`needSource="live"`).
- `checkAcceptance`: при `snapshotError` — блокирующая причина
  `SNAPSHOT_INVALID`, потребность НЕ считается вовсе (ни из snapshot, ни из
  live — нет «молчаливого fallback»); `SNAPSHOT_INVALID` добавлен в
  `BLOCKING_CODES` (параллельно Z-v27 `INVENTORY_UNIT_MISMATCH`).
- `checkOrderAcceptance`: прокидывает snapshotError, возвращает
  `needSource`. Роуты accept/acceptance-check изменений не требуют
  (409 ORDER_NOT_FEASIBLE формируется как раньше).

## 8. Связь с inventory journal

- Единый источник потребности: `computeIngredientNeeds`
  (`src/lib/ops/breakdown.ts`) расширен norm-режимом
  (`IngredientNeedInput.ingredientNorms`) — snapshot-позиции превращаются в
  синтетические строки норм и идут через ТУ ЖЕ агрегацию/конвертацию
  (`convertQty`, `src/lib/ops/units.ts`)/сопоставление со складом, что и
  live-позиции. Вторых независимых расчётов нет.
- `computeOrderBreakdown` читает metadata, валидирует, считает из snapshot
  (`need_source: "snapshot"|"live"`); повреждённый → `{ok:false, code:"SNAPSHOT_INVALID"}`
  → breakdown-роут отдаёт 409, purchase-draft НЕ создаёт черновик по
  случайной версии рецепта (409).
- **Списание** (order-путь 0048/0049) — контракт НЕ изменён (требование ТЗ
  «не переписывать идемпотентность»): количества задаёт кондитер, реестр
  `(owner, order, signature)` дедуплицирует повторные/параллельные
  отправки. Префилл количеств в UI берётся из breakdown → теперь из
  snapshot. Повторный accept не списывает (списания в accept нет —
  Z-v22/Z-v27). RPC 0071 и миграции 0049/0071 не менялись.
- Остатки склада остаются «живыми» в обоих режимах: snapshot фиксирует
  ПОТРЕБНОСТЬ, а не остатки.

## 9. Legacy-поведение

- Заказы, созданные до Z-v29 (нет ключа `acceptance_snapshot`): прежний
  live-расчёт; в ответах breakdown/acceptance-check явный
  `need_source="live"` — источник расчёта помечен, история не подменяется.
- Автоматический backfill ЗАПРЕЩЁН и не выполнялся: достоверного источника
  исторических версий рецептов не существует; восстановление «задним
  числом» выдавало бы текущий рецепт за исторический.
- Позиции с `order_items.product_id = NULL` (custom/удалённый товар) не
  покрываются snapshot и продолжают live-путь (RECIPE_MISSING — как раньше).
- Повреждённый snapshot не «чинится» автоматически —
  `SNAPSHOT_INVALID` блокирует приёмку/разбор до вмешательства владельца.

## 10. Миграции

**Не требуются** — используется существующая колонка `orders.metadata`
(0002_marketplace.sql:204). Новых миграций не создано; существующие
(включая 0049/0071) не изменялись, не удалялись, не переименовывались.
Опциональная generated-колонка/индекс по `metadata->'acceptance_snapshot'`
(Z-v28 §9.5 п.1) отложена: выборка snapshot всегда по primary key заказа.

## 11. Выполненные тесты и результаты

Новые (40):

- `src/lib/ops/snapshot.test.ts` (17): сборка (нормы/единицы/агрегация/
  детерминизм/паритет live-срезаний/fail при ошибке БД и отсутствии товара),
  чтение (absent/valid/unknown_schema/malformed/bad_item/bad_ingredient/
  empty_items), покрытие (подмена товара/количества).
- `src/lib/ops/snapshot-acceptance.test.ts` (10): ОБЯЗАТЕЛЬНЫЙ сценарий
  «рецепт A → заказ → рецепт B → acceptance по A» (live-рецепт даже не
  запрашивается), повторный accept идентичен, легаси live, повреждённый/
  частичный/чужой snapshot → SNAPSHOT_INVALID без live-расчёта,
  INVENTORY_UNIT_MISMATCH через snapshot-нормы, нехватка по норме A,
  удаление рецепта после оформления, расхождение количества order_items.
- `src/lib/ops/snapshot-breakdown.test.ts` (8): разбор по snapshot (A, не B),
  легаси live, SNAPSHOT_INVALID, смешанный norm+live батч, unit_mismatch
  внутри snapshot-норм.
- `src/app/api/checkout/snapshot-write.test.ts` (5): snapshot в том же INSERT
  заказов, серверный состав (клиентское тело не доверяется), replay
  идемпотентности, 503 fail-closed при ошибке сборки БЕЗ создания заказа,
  custom-only корзина без snapshot.

Регрессия затронутых областей (57): acceptance.test.ts 4/4 (Z-v27 P
INVENTORY_UNIT_MISMATCH — не регрессировал), breakdown.test.ts 9/9,
units.test.ts 17/17, checkout cart-clear-ownership 2/2 +
fillings-failclosed 4/4, orders API (accept-gate, assignment, [id]-роуты)
43/43, inventory write-off.idempotency 7/7, finance 24/24 (выборочно по
связанности), product-page.fillings-gate 3/3.

Команды: `bunx vitest run <файлы…>` (точечные проги, полный 1575-suite не
запускался — вне ТЗ). Итог: **все целевые и регрессионные тесты PASS**.

Статический контроль: `bunx tsc --noEmit` — 0 ошибок (весь проект);
`bunx eslint` на всех 14 затронутых файлах — 0 замечаний.

## 12. Ограничения проверки

- **DB-интеграционная проверка НЕ ВЫПОЛНЕНА.** Встроенный PG не
  инициализирован: `node scripts/db/runtime.mjs status` →
  «NOT INITIALIZED (no cluster at /home/z/my-project/.pgdata)» (данные
  утрачены при пересоздании контейнера — совпадает с Z-v28 §10);
  `127.0.0.1:54329` — ECONNREFUSED; бинарников psql/initdb нет; `.env.local`
  отсутствует. Восстановление БД-инфраструктуры и `db:setup` в рамках
  Z-v29 сознательно не выполнялись (не точечная задача; риск для
  работающего dev-контура). Логика проверена на изолированных
  mocked-pool/mocked-supabase тестах, SQL-формы идентичны существующим
  запросам тех же файлов. Полный PASS на реальной БД НЕ заявляется.
- Полный suite 1575 тестов и production build не запускались (ТЗ §9/§14).
- UI-отображение `need_source`/`SNAPSHOT_INVALID` в диалогах кондитера не
  добавлялось (backend-контракт отдаёт поля; UI-полировка — отдельная
  задача).
- Серверная проверка количеств write-off против snapshot-норм (аналог
  допуска 5% партийного пути) НЕ добавлялась: контракт order-пути 0048/0049
  менять запрещено ТЗ; отмечено как последующий шаг.

## 13. Известные риски

1. Checkout для товарных корзин теперь жёстко зависит от доступности БД
   на шаге сборки snapshot (fail-closed 503). Это требование контракта
   («оплата без снимка недопустима»), но усиливает чувствительность пути.
2. Ручная правка БД (direct UPDATE orders.metadata) может повредить
   snapshot → приёмка такого заказа заблокируется (fail-closed, явно).
   DB-уровень guard (триггер) не добавлялся — потребовал бы миграции.
3. Snapshot фиксирует состояние рецепта, но не рынок: склад/цены/закупки
   остаются живыми — задолженность/дефицит считаются по факту на момент
   приёмки (это корректность, не риск, но отмечено для ожиданий).
4. `recipe_updated_at` — сигнал целостности, не гарантия (нет крипто-
   подписи); подмена на уровне БД не детектируется.

## 14. План последующего staging-перехода

1. Применить изменения как обычный деплой кода (без миграций).
2. Контроль до/после релиза: `SELECT count(*) FROM orders WHERE type='product'
   AND status IN ('PENDING','CONFIRMED',...) AND metadata ? 'acceptance_snapshot'`
   — доля заказов со snapshot должна расти от 0; заказы без snapshot —
   легаси (need_source=live), их доля монотонно убывает.
3. Ручной smoke на staging: оформить заказ → изменить рецепт →
   acceptance-check/breakdown показывают потребность снимка
   (`need_source=snapshot`); легаси-заказ → live.
4. Мониторинг 409 `SNAPSHOT_INVALID` (должен быть = 0; любое появление —
   инцидент целостности данных).
5. Отдельные последующие задачи (вне Z-v29): UI-бейдж источника потребности;
   серверная валидация write-off против snapshot-норм; DB-guard на
   metadata.acceptance_snapshot; эволюция к варианту B (версионирование
   товарных рецептов) при появлении требования аудита рецептур.
