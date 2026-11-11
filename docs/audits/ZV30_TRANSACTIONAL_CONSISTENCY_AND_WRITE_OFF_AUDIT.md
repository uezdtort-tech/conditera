# Z-v30 — TRANSACTIONAL CONSISTENCY & INVENTORY WRITE-OFF AUDIT (восстановление документа, выполнено в Z-v31; факты верифицированы чтением кода и фактическим прогоном тестов Z-v31)

- **ID задачи:** Z31-3-g (закрывает строку ZV31-005 бэклога: документ Z-v30 не был создан из-за обрыва сессии).
- **Статус документа:** восстановление по 20-секционному плану Z-v30. Все числа взяты из верифицированных фактов сессий Z-v30/Z-v31 либо подтверждены повторным чтением рабочего дерева; ничего не выдумано, даты прогонов не указываются (помечено «Z-v31 verification run»).
- **Правило честности:** PASS ⇔ exit 0; всё, что не выполнено, помечено NOT VERIFIED / NOT RUN, а не «зелёное».

---

## 1. Исходная точка

- **HEAD на старте Z-v30:** `f8d426c`. **HEAD на старте Z-v31:** `f228119`.
- Коммиты в этом репозитории создаёт авто-снапшоттер (периодические UUID-коммиты рабочего дерева), поэтому «авторство» коммитов в истории — снапшоттер, а не сессии-этапы.
- Реализация Z-v29 (snapshot производственной потребности) была **не закоммичена** на момент своей сессии; авто-снапшоттер зафиксировал её коммитом **`064b3e3`** (16 файлов, +2205/−27): `snapshot.ts` (новый), snapshot-тесты, `acceptance.ts`, `breakdown.ts`, `checkout/route.ts`, `orders/route.ts`, маршруты breakdown/purchase-draft, `ops-client-types.ts`, документ ZV29.
- Фиксы Z-v30 были закоммичены как **`6552780`**, затем **перекоммичены снапшоттером под новым хэшем `89ca873`** (тот же набор из 7 файлов, размеры совпадают — проверено `git show --stat`). Хэш `6552780` в истории больше **не существует**; контент сохранён под `89ca873`. В этом документе ссылка на содержимое Z-v30 всегда означает `89ca873`.

## 2. Ядро Z-v29 — верификация: какие из 14 пунктов подтверждены кодом

Все 14 пунктов ядра Z-v29 подтверждены чтением кода (номера строк — по рабочему дереву на момент Z-v31, возможен дрейф ±несколько строк):

| # | Пункт | Подтверждение (файл:строки) |
|---|---|---|
| 1 | Серверное создание snapshot (только checkout / POST /api/orders) | `src/lib/ops/snapshot.ts:333–465` (`buildAcceptanceSnapshot`); вызовы: `src/app/api/checkout/route.ts:521–535` (source `checkout`), `src/app/api/orders/route.ts:454–462` (source `orders_b2b`) |
| 2 | Защита от клиентской подмены (тело запроса не содержит snapshot; идентификация по product_id) | `snapshot.ts:18–21` (контракт), `snapshot.ts:63–64` (product_id ↔ order_items), `checkout/route.ts:512–518` |
| 3 | Атомарность с INSERT заказа (metadata.acceptance_snapshot в той же строке orders) | `checkout/route.ts:565–572`, `orders/route.ts:498` |
| 4 | Полнота данных snapshot | `snapshot.ts:50–97` (ингредиент name/qty/unit/inventory_item_id; item product_id/title/quantity/recipe_id/recipe_version_id/recipe_updated_at/production params) |
| 5 | Неизменность после фиксации (ни один код-путь не пишет orders.metadata после INSERT) | grep `update("orders")` по `src` — совпадений в коде нет (единственное вхождение — комментарий `snapshot.ts:22`); проверено Z-v29, повторено Z-v30/Z-v31 |
| 6 | Использование acceptance / breakdown / purchase-draft из snapshot | `src/lib/ops/acceptance.ts:209`, `src/lib/ops/breakdown.ts:212`, `src/app/api/orders/[id]/purchase-draft/route.ts:24` (`computeOrderBreakdown`/`shortageForDraft`) |
| 7 | Legacy-режимы (absent → явный need_source="live"; в write-off — mode "legacy") | `breakdown.ts:278` (need_source snapshot/live), `write-off-validation.ts:92–96, 107–110` |
| 8 | Fail-closed (повреждённый snapshot → SNAPSHOT_INVALID; ошибка сборки → 503 до создания заказа) | `checkout/route.ts:528–534`, `orders/route.ts:454–462`, `write-off-validation.ts:111–117, 135–142` |
| 9 | Multi-item: агрегация строк корзины одного товара | `snapshot.ts:336–352` (qtyByProduct), детерминированный порядок `snapshot.ts:349` |
| 10 | Custom-позиции (order_items с product_id=null) не проверяются против snapshot | `snapshot.ts:270–273`, `write-off-validation.ts:129–134` |
| 11 | Replay-идемпотентность checkout (уникальный индекс 0060, 23505 → существующий заказ) | `checkout/route.ts:577–601` |
| 12 | Immutability против правки рецепта (правка меняет только НОВЫЕ заказы) | `snapshot.ts:14–16`; Z-v30 усилил: чтение одним SQL-статементом при сборке (`snapshot.ts:316–332, 356–393`) |
| 13 | Трассировка источника фиксации (source, snapshot_id, created_at, legacy-флаг) | `snapshot.ts:87–96` |
| 14 | Хранение исходных единиц рецепта; конвертация той же convertQty; unit_mismatch — fail-closed без неявных пересчётов | `snapshot.ts:26–28`, `write-off-validation.ts:178–183`, `src/lib/ops/units.ts` (convertQty) |

Пункт 5 — единственный, чьё «подтверждение» опирается на grep-отрицание (отсутствие кода), а не на позитивную конструкцию; это честное ограничение метода, а не доказательство на все будущие правки.

## 3. Контракт snapshot

Корень `orders.metadata.acceptance_snapshot` (`snapshot.ts:44, 85–97`):

| Поле | Тип | Смысл |
|---|---|---|
| `schema_version` | number | Текущая версия структуры: **1** (`ACCEPTANCE_SNAPSHOT_SCHEMA_VERSION`, `snapshot.ts:44`); неизвестная версия → invalid |
| `snapshot_id` | uuid | Генерирует сервер (`randomUUID`) |
| `created_at` | ISO-строка | Время фиксации |
| `source` | string | `"checkout"` \| `"orders_b2b"` |
| `legacy` | boolean | Всегда false для свежих snapshot; резерв под пометку legacy-восстановлений |
| `items` | массив | Позиции, отсортированные по product_id (детерминированное представление) |

Элемент `items` (`snapshot.ts:62–82`): `product_id` (связь с order_items.product_id), `title` (информационное), `quantity` (суммарное целое > 0), `recipe_id` (null — товар без рецепта), `recipe_version_id` (**всегда null** — товарный контур не публикует recipe_versions), `recipe_updated_at` (дешёвый сигнал целостности/аудита), производственные нормативы (`production_time_hours`/`prep_time_minutes`/`cook_time_minutes`/`category_slug`), `ingredients[]`: `name` (стабильный ключ сопоставления, как в live-пути), `qty` (норма на 1 единицу товара, > 0), `unit` (исходная единица рецепта), `inventory_item_id` (жёсткая привязка, если задана).

Чтение — строгое: `readAcceptanceSnapshot` (`snapshot.ts:134–267`) возвращает `absent` / `valid` / `invalid{reason}`; причины invalid: `unknown_schema_version | malformed | bad_item | bad_ingredient | empty_items`. Отсутствие — НЕ ошибка (легаси); повреждённый — никогда не «молчаливо заменяется текущим рецептом».

## 4. Checkout-транзакционный поток

Последовательность (`src/app/api/checkout/route.ts`):

1. Аутентификация, валидация корзины, ценовой снимок (tariff/commission/legal), промо (строки до 510).
2. **4b. Сборка snapshot** (`521–535`): `buildAcceptanceSnapshot` одним SQL-статементом; ошибка → **503 ДО создания заказа** (`528–534`) — fail-closed: недопустима оплата без производственного снимка.
3. **5. INSERT orders** (`542–575`): одна строка, `metadata.acceptance_snapshot` внутри того же INSERT (`565–572`) — запись snapshot атомарна с заказом. Гонка двух POST с одним Idempotency-Key разрешается индексом **0060**: 23505 → возврат существующего заказа (`577–601`).
4. **5b. INSERT order_items** (`606–614`): **отдельный statement**. При ошибке — компенсирующий `DELETE orders` (`616–620`).

**Что атомарно:** snapshot-build (один statement) + запись snapshot вместе с заказом (одна строка orders).

**Что НЕ атомарно (pre-existing, отмечено, в Z-v30 не менялось):** order_items — отдельный INSERT с компенсирующим delete. **Окно сбоя существует**: падение процесса между INSERT orders и INSERT order_items оставляет заказ без позиций (компенсация кодовая, а не DB-транзакция — она не сработает при падении процесса). Задокументировано как известное ограничение; исправление — общая DB-транзакция/один statement, в объём Z-v30 не входило.

## 5. Гонка правки рецепта

**Проблема:** `PATCH /api/recipes/[id]` мутирует корень рецепта и состав (recipe_ingredients) **отдельными запросами** (`src/app/api/recipes/[id]/route.ts:412, 549–570`; ZV31-003) — между ними существует промежуточный рассогласованный state.

**Fix Z-v30 (снапшот-путь):** `buildAcceptanceSnapshot` переписан на **ОДИН SQL-statement** (`snapshot.ts:377–393`): products LEFT JOIN recipes LEFT JOIN product_categories LEFT JOIN recipe_ingredients, `WHERE p.id = ANY($1::uuid[])`, ORDER BY p.id, ri.sort_order, ri.name. Statement в PostgreSQL выполняется над одним MVCC-снимком, поэтому конкурентная правка рецепта не может дать смешанный snapshot «нормы B + параметры A»: читаются либо целиком старое, либо целиком новое зафиксированное состояние состава. Прежняя двух-запросная версия (products, затем ingredients) этим свойством не обладала.

**Что осталось:** live-пути (легаси-заказы, need_source="live" в `breakdown.ts:164–360` — раздельные SELECT orders / recipe_ingredients / inventory_items) читают по текущему рецепту несколькими запросами и от гонки PATCH **не защищены**; это ZV31-003 (OPEN).

## 6. Карта списаний

| Путь | Инициатор | Источник норм | Snapshot | Идемпотентность | Статус |
|---|---|---|---|---|---|
| `POST /api/inventory/write-off` (order_id) | Кондитер при готовке (заказ PREPARING) | `metadata.acceptance_snapshot` заказа (Z-v30: `validateOrderWriteOffAgainstSnapshot`; convertQty; минус уже списанное по реестру) | Snapshot-режим | Реестр 0049 (owner+order+signature; 23505 → replay) | Активен; валидация против snapshot добавлена Z-v30 |
| `POST /api/inventory/write-off` (batch_id) | Списание производственной партии | Нормы card_version (immutable): qty_per_unit × planned_qty, waste_pct, конвертация; допуск 5% (BATCH_QTY_TOLERANCE) | Immutable card_version snapshot | Идемпотентность внутри RPC 0071 | Активен; Z-v30 НЕ тронут |
| `POST /api/inventory/movements` (IN/OUT/ADJUST) | Владелец склада/оператор | Нет норматива (ручные движения) | Нет (вне заказа) | Нет ключа дедупликации; атомарность — RPC 0048 | Активен |
| `POST/PATCH /api/inventory/items`, supplier products (quantity) | Владелец/оператор | Целевой остаток → ADJUST/OUT через журнал (`setQuantityViaMovement`) | Нет | Через RPC 0048 (одна транзакция) | Активен |
| Отмена заказа (`POST /api/orders/[id]/cancel`) | Покупатель/кондитер/админ | — | — | Возврат платежа (YooKassa refund) | **Политика: остатки НЕ трогает** |

## 7. Все реальные пути изменения остатков

Четыре реальных код-пути, меняющих `inventory_items.quantity` (все — через журнал движений; прямые UPDATE quantity в API запрещены):

1. **Order-списание**: `POST /api/inventory/write-off` с order_id → `applyInventoryMovement` (OUT) через RPC `apply_inventory_movement_atomic` (`write-off/route.ts:269–275`; `src/lib/inventory.ts:101, 125–129`) + реестр `inventory_write_offs` (0049). С Z-v30 — с валидацией против snapshot заказа.
2. **Партийное списание**: тот же маршрут с batch_id → единственный путь — RPC `apply_inventory_write_off_batch` (0071): одна транзакция, полный откат при ошибке любой позиции, GRANT EXECUTE только service_role; RPC отсутствует → fail-closed (`write-off/route.ts:640–655`).
3. **Ручные движения**: `POST /api/inventory/movements` (IN/OUT/ADJUST) → `applyInventoryMovement` (`movements/route.ts:130`) через RPC 0048: блокировка строки, баланс+журнал в ОДНОЙ транзакции, guard `OUT` (остаток ≥ 0), fail-closed 500 при отсутствии RPC (`inventory.ts:150–157`).
4. **Заведение/правка позиций склада**: `POST/PATCH /api/inventory/items` и quantity в supplier products — через `setQuantityViaMovement` (`inventory.ts:217–249`): target>0 → ADJUST, target=0 → OUT текущего остатка; тот же RPC 0048.

**Cancel-политика:** отмена заказа возвращает платёж (YooKassa refund, `src/app/api/orders/[id]/cancel/route.ts` ~149) и **не производит движений по складу** — задокументированная политика (возврат ингредиентов при отмене выполняется ручными движениями, если оператор сочтёт нужным).

## 8. Идемпотентность

| Механизм | Объект | Как работает |
|---|---|---|
| Уникальный индекс **0060** `(user_id, metadata->>'idempotency_key')` | Checkout | Гонка параллельных POST с одним ключом: победитель-проигравший получает 23505 → возврат существующего заказа (replay), второго несовместимого snapshot не возникает (`checkout/route.ts:577–601`) |
| Реестр **0049** `inventory_write_offs` по (owner, order, signature) | Order-списание | Повторная/параллельная отправка того же батча → 200 `idempotent:true` без повторных движений (`write-off/route.ts:192–212`); 23505 на INSERT реестра → результат успевшего первым (`300–332`). Списания без order_id не дедуплицируются (нет ключа) |
| RPC **0071** `apply_inventory_write_off_batch` | Партийное списание | Идемпотентность внутри RPC (write_off_id, повтор → сохранённый результат), одна транзакция, полный откат |
| RPC **0048** `apply_inventory_movement_atomic` | Все движения | Атомарность (row-lock, баланс+журнал в одной транзакции), guard OUT ≥ 0; **key-based идемпотентности не даёт** — дедупликация order-списаний обеспечивается слоем реестра 0049 |

Ограничение, зафиксированное честно: идемпотентность 0049 дедуплицирует **повторы того же батча**, но до Z-v30 не связывала количество с потребностью заказа — эту роль выполняет новая валидация (§ 12, Fix 2).

## 9. Параллельные сценарии

**Защищено:**

- Двойной checkout с одним Idempotency-Key — индекс 0060 + replay (§ 8).
- Повтор/гонка order-списания одного и того же батча — реестр 0049 + 23505 → replay (`write-off/route.ts:300–332`).
- Конкурентная правка рецепта против фиксации заказа — для снапшот-пути снята чтением одним SQL-статементом (§ 5).
- Отрицательный остаток — guard OUT ≥ 0 внутри RPC 0048; партия — полный откат RPC 0071.

**Не защищено (ZV31-002, OPEN):** кумулятивная конкурентная гонка order-списания. `validateOrderWriteOffAgainstSnapshot` читает реестр `inventory_write_offs` **до** применения батча (TOCTOU, `write-off-validation.ts:187–205`): два параллельных POST с разными количествами оба проходят валидацию (каждый видит «уже списано: 0»), затем оба применяются — суммарно превысив норму snapshot. При этом per-item баланс ≥ 0 по-прежнему гарантирует RPC 0048 — остаток физически не уйдёт в минус; нарушается именно норматив snapshot. Фикс: атомарный check-and-apply RPC либо advisory-lock по order_id (+ тест на конкуренцию).

Также открыто ZV31-003 (§ 5): нетранзакционный PATCH рецепта — промежуточный state для live-путей.

## 10. Откат и частичные отказы

- **Сборка snapshot не удалась** → 503 **до** создания заказа и, следовательно, до оплаты (`checkout/route.ts:528–534`; аналогично B2B-путь `orders/route.ts:454–462`). Деньги не списываются, заказ не создаётся.
- **Ошибка INSERT order_items** → компенсирующий DELETE созданного заказа (`checkout/route.ts:616–620`). Pre-existing компенсация; окно сбоя между двумя INSERT существует (§ 4).
- **Order-списание с частичным отказом**: позиции применяются по одной через RPC 0048; ответ содержит `applied[]` + `failed[]`; если ни одна не применена — ошибка первой причины (`write-off/route.ts:268–298`). Батч уже применён, но INSERT реестра упал → НЕ откатываем (журнал inventory_movements полон), логируем и возвращаем успех — реестр оптимизация, не источник истины (`300–331`).
- **Партия (batch_id)**: RPC 0071 — одна транзакция, полный откат при любой ошибке позиции; недостаток остатка → 409, unit mismatch → 422 (`write-off/route.ts:365–374`).
- **Ручные движения**: RPC 0048 — атомарно; отсутствие RPC → fail-closed 500 с требованием применить 0048 (`inventory.ts:150–157`).

## 11. Legacy-заказы

- **Snapshot отсутствует** (заказы, созданные до Z-v29): acceptance/breakdown считают по текущему рецепту с явным `need_source="live"` (`breakdown.ts:278`); write-off-валидация возвращает `mode: "legacy"` без отклонений (`write-off-validation.ts:107–110`); заказ не найден вовсе — тоже legacy с сохранением прежнего поведения (`92–96`). История не выдумывается, текущий рецепт не подставляется задним числом.
- **Snapshot повреждён/чужой** (invalid, либо не покрывает order_items): `SNAPSHOT_INVALID` fail-closed **везде** — acceptance/breakdown и write-off (`write-off-validation.ts:111–117, 135–142`); нормативное списание блокируется, ручные корректировки остаются доступны через `POST /api/inventory/movements`.
- **Backfill запрещён**: достоверного источника исторических версий рецептов не существует (`snapshot.ts:31–33`).
- **Custom-позиции** (order_items с product_id=null) против snapshot не проверяются — покрытие валидируется только по товарным позициям.

## 12. Изменения кода Z-v30

Два фикса, **7 файлов, суммарно +770/−72** (коммит `89ca873`; примечание: в per-file цифрах ниже для новых файлов указан полный размер файла, для изменённых — дельта diff, поэтому столбец не арифметически равен итогу diffstat).

| Файл | Изменение |
|---|---|
| `src/lib/ops/write-off-validation.ts` | **НОВЫЙ**, 241 строка: `validateOrderWriteOffAgainstSnapshot`, `WRITE_OFF_ROUNDING_EPSILON`, типы отклонений (Fix 2) |
| `src/app/api/inventory/write-off.snapshot-validation.test.ts` | **НОВЫЙ**, 343 строки: тесты валидации против snapshot |
| `src/lib/ops/snapshot.ts` | модификация, 114 строк: `buildAcceptanceSnapshot` переписан на чтение одним SQL-статементом (Fix 1) |
| `src/lib/ops/snapshot.test.ts` | +64 строки: тесты нового чтения |
| `src/app/api/inventory/write-off/route.ts` | +53 строки: вызов валидации, 422 `WRITE_OFF_SNAPSHOT_MISMATCH`, `allow_overage`, маркер причины |
| `src/app/api/inventory/write-off.idempotency.test.ts` | +9 строк |
| `src/app/api/checkout/snapshot-write.test.ts` | +18 строк |

**Fix 1 (checkout-согласованность)** — § 4–5: snapshot одним SQL-статементом (statement-level MVCC), атомарность с INSERT, 503 до оплаты, replay по 0060.

**Fix 2 (списание против snapshot)** — `write-off-validation.ts`: читает metadata заказа + валидность snapshot (absent → legacy; invalid → `SNAPSHOT_INVALID` fail-closed 422); `validateSnapshotCoversOrder` (набор товаров + количества); резолв позиций склада владельца — по `inventory_item_id`, иначе точное имя; ожидаемое по позиции = Σ(норма × quantity товара), конвертация `convertQty` (`units.ts`, та же, что в breakdown); из ожидаемого вычитается уже списанное по реестру `inventory_write_offs` — **прогрессивное частичное списание работает, кумулятивный контроль включён**; отклонения `not_in_snapshot` / `unit_mismatch` / `overage` → 422 `WRITE_OFF_SNAPSHOT_MISMATCH` с перечнем (`write-off/route.ts:234–245`); `allow_overage: true` + причина → списание проходит как РУЧНАЯ корректировка: причина получает маркер «(превышение норматива snapshot подтверждено оператором)» (`route.ts:262–266`, audit trail в inventory_movements), **snapshot заказа НЕ переписывается**. `WRITE_OFF_ROUNDING_EPSILON = 1e-6` — только погрешность округления (round6/UI), **не** бизнес-допуск. Идемпотентный replay старого батча валидацию не проходит (повтор прошлого действия) — валидируются только новые батчи (`route.ts:214–216`).

## 13. Миграции

**НЕ создавались.** Миграции `0048_inventory_atomic_movement.sql`, `0049_inventory_write_off_idempotency.sql`, `0060_p11_hardening_integrity.sql`, `0071_inventory_writeoff_idempotency_rls.sql` присутствуют в `supabase/migrations/` и Z-v30 не тронуты (в diff `89ca873` — только 7 файлов кода/тестов, ни одного migration). Это соответствует правилу Z-v30: без верифицированной PG-интеграции миграции не пишутся и mock-подмены не предъявляются.

## 14. Тестовые команды

Точные команды (Z-v31 verification run; `--reporter=basic` в актуальном vitest удалён и падал — см. ZV31-009, используется `dot`):

```bash
# Целевые 14 файлов (6 Z-v30/Z-v29 suites + 8 файлов регрессионного набора Z-v31):
bunx vitest run \
  src/lib/ops/snapshot.test.ts \
  src/lib/ops/snapshot-breakdown.test.ts \
  src/lib/ops/snapshot-acceptance.test.ts \
  src/app/api/checkout/snapshot-write.test.ts \
  src/app/api/inventory/write-off.snapshot-validation.test.ts \
  src/app/api/inventory/write-off.idempotency.test.ts \
  <ещё 8 файлов целевого набора Z-v31> \
  --reporter=dot

# Type-check: bunx-вызов падал по памяти (OOM kill, exit 137 — песочница),
# рабочий вызов — node с увеличенным heap:
node --max-old-space-size=1536 <node_modules/.bin/tsc> --noEmit

# ESLint по затронутым Z-v30 файлам
eslint <affected files>
```

## 15. Результаты тестов (Z-v31 verification run)

Даты прогонов не воспроизводятся (обрыв сессии) — все результаты ниже помечены как **Z-v31 verification run**:

- `bunx vitest run` (14 целевых файлов, reporter=dot): **exit 0; Test Files 14 passed; Tests 174 passed**. В набор входят Z-v30 suites: `snapshot.test.ts`, `snapshot-breakdown.test.ts`, `snapshot-acceptance.test.ts`, `snapshot-write.test.ts`, `write-off.snapshot-validation.test.ts`, `write-off.idempotency.test.ts`. Заявление эпохи Z-v29 «129/129» **считается перекрытым** этим более широким прогоном.
- `tsc --noEmit` (через `node --max-old-space-size=1536`): **exit 0**. Bunx-вызов был OOM-убит песочницей (exit 137) — инфраструктурная причина, не ошибки типов.
- ESLint по затронутым файлам: **exit 0, 0 errors**.

## 16. Состояние DB-интеграции: NOT VERIFIED

Реальные PostgreSQL-транзакции Z-v30/Z-v29-механизмов **не проверялись**:

- `.pgdata` отсутствует (embedded PG не инициализирован; `scripts/db/runtime.mjs` ожидает `<project>/.pgdata`);
- CLI-утилиты отсутствуют на PATH: `psql`, `pg_isready`, `initdb`, `pg_ctl`;
- состояние порта 54329 **не проверено** (обрыв сессии до пробы);
- следствие: поведение RPC `apply_inventory_movement_atomic` (0048) и `apply_inventory_write_off_batch` (0071), уникального индекса 0060 и конкурентных прогонов на живом PG не исполнено; сценарий Z-v30 §9 (DB-сценарий) не повторён.

По правилам Z-v30 миграции не создавались и mock-подмены (fake-пул / имитация RPC) не предъявлялись — отсутствие проверки честно констатируется, а не маскируется. Регистрация долга: ZV31-004 (P1, OPEN).

## 17. Неподтверждённые заявления Z-v29/Z-v30

- **«96 тестов»** из Z-v30-промпта: фактический прогон оказался шире — **174/174** (14 файлов); «96» перекрыто и не используется как аргумент.
- **PG integration**: не подтверждена (§ 16).
- **Семантика `recipe_updated_at`**: в snapshot хранится timestamp без `recipe_version_id` (поле сейчас всегда null — `snapshot.ts:71–74, 439–441`). **Достаточность timestamp для уникальной идентификации версии рецепта НЕ доказана** (коллизии времени/два обновления в один тик); зафиксировано как ограничение контракта — поле заявлено как «дешёвый сигнал целостности/аудита», а не идентификатор версии.
- Иммутабильность `orders.metadata` (§ 2, пункт 5) — grep-отрицание, а не конструктивная гарантия (триггеры/внешние писатели в БД теоретически возможны).

## 18. Оставшиеся блокеры

| ID | Приоритет | Суть | Фикс |
|---|---|---|---|
| **ZV31-002** | P2 | Кумулятивная конкурентная гонка order-списания: валидация читает реестр до применения (TOCTOU); два параллельных разных батча могут суммарно превысить норму snapshot (баланс ≥ 0 при этом держит RPC 0048) | Атомарный check-and-apply RPC или advisory-lock по order_id + тест на конкуренцию |
| **ZV31-003** | P2 | Нетранзакционный PATCH рецепта: корень и ingredients мутируются отдельными запросами; для снапшот-пути смягчено одностатементным чтением, **live-пути остаются уязвимы** | Единая транзакция/один statement + тест |
| **ZV31-004** | P1 | PostgreSQL integration NOT VERIFIED: embedded PG не инициализирован, утилиты отсутствуют, порт не проверен | `bun run db:start` → disposable `.pgdata`; `scripts/verify/diagnostics-verify.mjs` 5/5; повтор сценария Z-v30 §9 |

## 19. Итоговый вердикт Z-v30

**PARTIAL — DB INTEGRATION NOT VERIFIED.**

Код обоих фиксов реализован и подтверждён чтением (§ 4–5, § 12), целевые тесты зелёные (174/174, exit 0; tsc exit 0; eslint exit 0). Однако реальные PG-транзакции (RPC 0048/0071, индекс 0060) и конкурентные прогоны на живой БД **не выполнялись** — интеграционное утверждение остаётся непроверенным. Fail-closed-архитектура (503 до оплаты, SNAPSHOT_INVALID, fail-closed при отсутствии RPC) снижает риск до момента верификации, но не заменяет её.

## 20. Рекомендация следующему этапу

1. **Единая система эксплуатации** — реализовано в Z-v31: `docs/operations/PRODUCT_OPERATING_SYSTEM.md` (жизненный цикл ошибки, три уровня регрессионных проверок, release gate, честные статусы PASS/NOT RUN) + каркас regression runner (`scripts/regression/run-checks.mjs`, `check:quick`/`check:full`, реестр результатов `docs/operations/checks/`).
2. **Атомарный check-and-apply RPC для order write-off** (закрытие ZV31-002) — при появлении верифицированной БД: проверка норматива и запись движения в одной транзакции либо advisory-lock по order_id; вместе с ним — транзакционный PATCH рецепта (ZV31-003) и повтор DB-сценария Z-v30 §9 (ZV31-004).

---

*Footer: защищённые файлы не тронуты (scripts/hooks/, scripts/protected-paths.sh, src/app/api/upload/, src/app/api/services/upload/). Push/deploy не выполнялись. Документ создан в рамках Z31-3-g (Z-v31) как восстановление Z-v30; единственное изменённое дерево-файл — сам этот документ.*
