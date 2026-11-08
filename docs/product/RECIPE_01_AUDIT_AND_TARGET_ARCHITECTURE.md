# RECIPE-01 — Полный аудит рецептурной системы и целевая архитектура унификации

**Репозиторий:** `uezdtort-tech/conditera` · **Дата аудита:** 2026-11-08 · **Режим:** только чтение
**Git HEAD на момент аудита:** `fe8beb0cce925dc839dbf96c790f5869adbef002` (main, ahead 187 / behind 0 vs origin/main)
**Рабочее дерево:** чистое; 4 защищённых upload-файла присутствуют на диске, skip-worktree не установлен.
**Метод верификации:** каждый вывод подтверждён чтением кода (file:line), DDL миграций и/или живой
read-only интроспекцией БД (PostgreSQL 18.4, information_schema / pg_policies / pg_constraint).
Блокер B1 (`0064_supplier_procurement.sql`, text=uuid) в рамках RECIPE-01 не затрагивался и на
рецептурные таблицы не влияет (0064 откатывается целиком, ledger = 63 миграции).

---

## A. Executive summary

### A.1. Общее состояние

Фактически в репозитории сосуществуют **три независимых «рецептурных контура»** на **трёх разных
наборах таблиц**, слабо связанных между собой:

| # | Контур | Таблицы | Реальное состояние |
|---|---|---|---|
| I | **Контентный** (блог/контент рецептов, MDX) | `recipes`, `recipe_acceptances` (0010) | Таблица жива (1 демо-строка), публичного UI нет; используется как FK-цель для `products.recipe_id`, `recipe_ingredients.recipe_id`, читается очередью модерации и recipe-stats. Запись из UI — нет |
| II | **Коммерческий маркетплейс** (платные рецепты, роялти) | `recipe_marketplace`, `recipe_purchases`, `recipe_subscriptions` (0012) | **Единственный реально работающий публичный контур**: каталог `/recipes`, карточка, покупка (201 по e2e-протоколу), дашборд автора. Роль издателя — только RECIPE_DEVELOPER |
| III | **Производственный** (нормы ингредиентов, склад) | `recipes` → `recipe_ingredients` (0053) → `inventory_items` (0010), движения 0046/0048/0049 | Расчётная цепочка «заказ → товар → рецепт → ингредиенты → склад» **кодом работает**, но данные в `recipe_ingredients` некому ввести из приложения (0 операций записи в src/) |

Параллельно существует **четвёртый, демонстрационный слой**: Zustand-стор `store.recipes`
(MOCK_RECIPES) с 4 action'ами, который до сих пор смонтирован во вкладке «Рецепты» кабинета
кондитера и создаёт у кондитера иллюзию работающих рецептов.

### A.2. Что уже работает (подтверждено)

1. **Каталог и карточка рецептов** на реальном API: `recipes-catalog.tsx:81` → `GET /api/recipes/marketplace`
   → `recipe_marketplace` (после конвергенции 2026-10-31 мок-фолбэк каталога убран).
2. **Создание/удаление рецепта автором** RECIPE_DEVELOPER: POST/DELETE `/api/recipes/marketplace`
   реально пишут в БД; ownership проверяется на сервере (PATCH `[id]/route.ts:138-143`).
3. **Покупка рецепта**: POST `.../purchase` → INSERT в `recipe_purchases` с роялти/комиссией,
   идемпотентность по (recipe_id, buyer_id, is_active) — подтверждено e2e-протоколом
   `docs/evidence/e2e-tally/recipe-purchase-flow.prod.json` (201).
4. **RLS** на всех таблицах контуров I–II (проверено по `pg_policies`, 18 политик).
5. **Расчёт потребности в сырье** по заказу: `ops/breakdown.ts` реально читает
   `recipe_ingredients` + склад владельца, конвертирует единицы (г/кг/мл/л/шт/дес), считает
   дефицит и закупочный черновик; связь «ингредиент ↔ складская позиция» существует через
   FK `recipe_ingredients.inventory_item_id` (SET NULL) + фолбэк по имени.
6. **Атомарное списание** с идемпотентностью: RPC `apply_inventory_movement_atomic` (0048) +
   реестр `inventory_write_offs` с sha256-подписью батча (0049, UNIQUE(owner, order, signature)),
   регрессионный тест `write-off.idempotency.test.ts`.

### A.3. Что существует только в интерфейсе (не доходит до БД)

1. **Вкладка «Рецепты» кабинета кондитера** (`ConfectionerRecipesManager`): форма создания/редактирования
   (название, ингредиенты, шаги, цена) пишет **только в Zustand** (`addRecipe` → `set({recipes})`,
   store.ts:663-673). `recipes` **не входит** в persist `partialize` (store.ts:2234-2248) → после
   перезагрузки всё исчезает; в публичный каталог не попадает никогда. Кондитер (CONFECTIONER)
   **не имеет ни одного пути опубликовать рецепт в БД**.
2. **«В избранное» / «Сохранить»** на карточке рецепта — только `toast.success`, ничего не сохраняет
   (recipe-detail-page.tsx:397-426); флаг `purchased` — client-state, сбрасывается при reload.
3. **Пересчёт порций** — степпер `useState(4)` (recipe-detail-page.tsx:56), в БД `servings` нет,
   ингредиенты не масштабируются.

### A.4. Критические дефекты

| # | Дефект | Доказательство |
|---|---|---|
| D1 | **«Принять рецепт в работу» сломан**: INSERT в `recipe_acceptances` использует колонки (`confectioner_id, price_from, price_to, prep_days, delivery, self_pickup, notes, status`), которых нет в таблице (фактические: `recipe_id, user_id, rating, comment, photo_url`) → PGRST204/500 | accept/route.ts:140-155 vs live-схема; миграций, меняющих таблицу, нет (grep supabase/) |
| D2 | **Список принявших деградирует в мок**: при ошибке/пустой БД API отдаёт `MOCK_ACCEPTANCES` — фиктивные «кондитеры рядом» в проде | acceptances/route.ts:284-286 |
| D3 | **Платный рецепт «покупается» без оплаты**: `payment_id` принимается из body и никогда не проверяется | purchase/route.ts:108-116 |
| D4 | **Контент не за пейволлом**: GET карточки делает `select("*")` — steps_json/ingredients_json отдаются всем без проверки покупки | `[id]/route.ts:55-59` |
| D5 | **Форма автора-разработчика — заглушка**: ингредиенты/шаги уходят в БД константами-заглушками, фото-поля нет | recipe-developer-dashboard.tsx:607-608 |
| D6 | **Модерация рецептов не работает**: очередь читает `recipes`, но `/api/moderator/action` не знает type="recipe" → 400 | moderator/action/route.ts:37-45 |
| D7 | **Нет единой сущности рецепта**: три контура, дублирующие поля (title/description/time/difficulty в 3 таблицах), FK-цели разъехались | 0010, 0012, live-схема |
| D8 | **Технологической карты как сущности нет**: grep `production_card|tech_card` по миграциям и src = 0; роль ТК исполняют 3 несвязанных артефакта | см. §I |
| D9 | **4+ независимых расчёта денег** (себестоимость/стоимость склада/закупки) — см. §10/§E.9 | breakdown.ts:352-360; rules.ts:509-513; supplier/dashboard/route.ts:152-155; confectioner-extra-tabs.tsx:1050 |
| D10 | **Редактирование рецепта задним числом меняет уже оформленные заказы**: breakdown читает живые `recipe_ingredients`, снапшота нет | write-off/route.ts:8-9; breakdown.ts:221-228 |
| D11 | Прямые UPDATE `quantity` мимо журнала движений | inventory/items PATCH :198-204; supplier/products PATCH :260-264 |

### A.5. Критические риски

- **Репутационный:** прод-пользователь видит фиктивных кондитеров (D2) и «покупает» платные рецепты бесплатно (D3).
- **Продуктовый:** кондитер не может довести рецепт до товара/производства — разрыв между контентом и коммерцией (A.3, D5).
- **Финансовый:** роялти фиксируется, но выплатной механики нет; списание может быть повторено через /movements мимо реестра.
- **Архитектурный:** дальнейшее наращивание любого из трёх контуров углубляет дублирование (D7).

---

## B. Реестр существующих реализаций

### B.1. Таблицы БД (живая интроспекция, PostgreSQL 18.4; RLS проверен по pg_policies)

| Таблица | Миграция | Строк (live) | Назначение | Статус | RLS |
|---|---|---|---|---|---|
| `recipes` | 0010:106-138 | 1 (демо «Красный бархат») | Контентные рецепты: content MDX, nutrition (calories/protein/fat/carb), status draft/published | **Полуживой**: FK-цель, читается модерацией/статистикой; UI-записи нет | 3 политики (select public / insert+update own) |
| `recipe_acceptances` | 0010:146-155 | 0 | «Кондитер принял рецепт» (_rating/comment_) | **Сломан** (D1): API пишет несуществующие колонки | 2 политики |
| `recipe_marketplace` | 0012:64-87 | 3 (published) | Платные рецепты: steps_json, ingredients_json, base_price, royalty_rate, difficulty 1-5 | **Работает** (чтение+запись API) | 5 политик |
| `recipe_purchases` | 0012:97-109 | 0 | Покупки: price_paid, royalty_amount, commission_amount, payment_id | Работает (запись), оплата не enforced (D3) | 3 политики |
| `recipe_subscriptions` | 0012:118-131 | 0 | Подписки на автора | **Таблица без кода** (API/UI нет; «Скоро» в дашборде) | 3 политики |
| `recipe_ingredients` | 0053:132-141 | 5 (демо-рецепт, 4/5 связаны со складом) | Нормализованные нормы: name, qty numeric(12,3), unit, **inventory_item_id FK**, sort_order | **Читается** breakdown; записи из приложения нет | SELECT-only |
| `inventory_items` | 0010:218-231 | 12 | Склад: owner_id, quantity numeric, unit TEXT (свободный), cost_per_unit INTEGER, supplier | Работает (свой CRUD API) | ALL own |
| `inventory_movements` | 0046:17-26 | 12 | Журнал движений IN/OUT/ADJUST | Работает (через RPC 0048) | **RLS НЕ включён** |
| `inventory_write_offs` | 0049:17-26 | 0 | Идемпотентность списаний (signature UNIQUE) | Работает | **RLS НЕ включён** (service role) |
| `order_production` / `order_production_checklist` | 0054:118-166 | 0 | Производственные метки заказа: оценка времени, риск, чеклист 10 стадий | Работает (время/статусы), со складом не связан | SELECT-only |
| `stock_movements` (легаси) | 0010:236-243 | 0 | Старый журнал (inventory_id) | **Мёртвый** (новая цепочка не использует) | — |

### B.2. API-маршруты

| Маршрут | Методы | Файл | Статус |
|---|---|---|---|
| `/api/recipes/marketplace` | GET, POST | `src/app/api/recipes/marketplace/route.ts` | Работает; POST: requireRole RECIPE_DEVELOPER (:200-207), ручная валидация (:212-246), slug-уникальность (:252-256) |
| `/api/recipes/marketplace/[id]` | GET, PATCH, DELETE | `src/app/api/recipes/marketplace/[id]/route.ts` | Работает; GET без пейволла (D4); views race (:88-92); DELETE soft при наличии покупок (:256-260); **PATCH без UI-потребителя** |
| `/api/recipes/marketplace/[id]/purchase` | POST | `.../purchase/route.ts` | Работает; оплата не enforced (D3); royalty = price×royalty_rate, комиссия 10% (:104-105) |
| `/api/recipes/[id]/accept` | POST | `src/app/api/recipes/[id]/accept/route.ts` | **Сломан** (D1) |
| `/api/recipes/[id]/acceptances` | GET | `src/app/api/recipes/[id]/acceptances/route.ts` | Деградирует в мок (D2) |
| `/api/confectioner/recipe-acceptances` | GET | `src/app/api/confectioner/recipe-acceptances/route.ts` | Сломан (D1) + семантика: `confectioner_id = user.id` вместо `confectioners.id` (:39-44) |
| `/api/confectioner/recipe-stats` | GET | `src/app/api/confectioner/recipe-stats/route.ts` | Работает с фолбэками на audit_logs; читает старую `recipes` (:164-167) |
| `/api/moderator/queue` + `/api/moderator/action` | GET, POST | `src/app/api/moderator/*` | Очередь читает `recipes` (:163-189), action type="recipe" → 400 (D6) |
| `/api/upload` | POST | `src/app/api/upload/route.ts` (ЗАЩИЩЁН, не меняем) | Общий; медиа рецептов = generic category=recipe |
| `/api/inventory/items` `/movements` `/write-off` | CRUD | `src/app/api/inventory/*` | Работают; write-off идемпотентен (sha256-батч, :60-70) |

### B.3. Библиотеки (src/lib)

| Файл | Назначение | Статус |
|---|---|---|
| `recipe-view-model.ts` | Маппер строки `recipe_marketplace` → UI Recipe; дефолт-заглушки честные («Имени автора в таблице нет», :128-129) | Работает; потребители: каталог + деталь. Докстринг заявляет юнит-тесты — их нет |
| `ops/breakdown.ts` | Потребность заказа в сырье → склад → дефицит → estimated_cost | Работает (§C.4) |
| `ops/units.ts` | Словарь единиц: г/гр/кг/ml/л/шт/дес(×10); `convertQty` | Работает; **нет**: ложек, стаканов, упаковок, «по вкусу» |
| `ops/acceptance.ts`, `ops/production-duration.ts`, `ops/assignment.ts` | Время производства из recipes.prep/cook; позиции заказа = recipe_id × qty | Работают (контур III) |
| `store.ts` recipes-слои | addRecipe(:663-673) и createRecipe/updateRecipe/deleteRecipe(:1373-1394) — **дубль семантики**, id-форматы разные (`recipe_*` vs `rc*`) | **Демо**, без сети, без persist |
| `supabase/types.ts:194-255` | Ручные типы RecipeMarketplace/Purchase/Subscription | Работает |
| `meilisearch.ts:49` (`recipes` индекс), `schema-org.tsx:147` (recipeJsonLd), `backup.ts:137`, `cleanup.ts:569`, `prisma/schema.prisma:688-715` | Объявления без потребителей | **Мёртвые** |

### B.4. Компоненты UI

| Компонент | Файл | Источник данных | Запись | Статус |
|---|---|---|---|---|
| Каталог `/recipes` | `pages/recipes-catalog.tsx` (395 стр.) | TanStack Query → API (`?sort=popular&limit=100`) | нет | Живой; пагинации нет, фильтры клиентские (:95-133) |
| Деталь рецепта | `pages/recipe-detail-page.tsx` (811 стр.) | API карточка + acceptances | purchase, accept; избранное/сохранить — фикция | Живой; `expert`→«Легко» баг словаря (:44-48,307); «Рекомендации» захардкожены (:551-563) |
| Оболочка `/recipes` | `components/recipes-route.tsx` (98 стр.) | URL/store nav | нет | Живой; файла `pages/recipes-route.tsx` **не существует** (дубля нет) |
| Вкладка «Рецепты» кондитера | `dashboard/confectioner-promotions-recipes-manager.tsx:218-552` | **store.recipes (мок)** | addRecipe/updateRecipe/deleteRecipe → Zustand | Живой-смонтирован, **демо-слой** (A.3) |
| Дашборд RECIPE_DEVELOPER | `dashboard/recipe-developer-dashboard.tsx` (756 стр.) | supabaseBrowser (RLS) + API | POST/DELETE marketplace | Живой; форма-заглушка (D5); вкладка подписок «Скоро» |
| «Статистика рецептов» кондитера | `dashboard/confectioner-recipe-stats-tab.tsx` (355 стр.) | GET /api/confectioner/recipe-stats | нет | Живой |
| `ConfectionerRecipesTab` + его диалог | `dashboard/confectioner-extra-tabs.tsx:665-950` | store | store | **Мёртвый** (0 импортёров; мусор «基本信息» в :901) |
| `ImageUploader` | `components/ui/image-uploader.tsx` | — | — | **Мёртвый** (заглушка «В реальном приложении — POST /api/upload») |

### B.5. Тесты (существующие)

| Тест | Покрывает | Реально проверяет |
|---|---|---|
| `pages/recipes-page.test.tsx` (5 тестов) | Каталог | Запрос `?sort=popular&limit=100`, клик→navigate с uuid из БД, error/empty/skeleton |
| `ops/breakdown.test.ts` | Контур III | Потребность/дефицит/статусы, связка со складом |
| `ops/units.test.ts` | Конверсия единиц | г/кг/мл/л/шт/дес; несовместимые → unit_mismatch |
| `api/inventory/write-off.idempotency.test.ts` | Списание | Контракт 0048/0049: дедуп по signature |
| `ops/risk.test.ts`, `ops/capacity.test.ts`, `ops/deadline.test.ts` | Производство | Время/риск/окна (не склад) |
| `tests/e2e/recipe-purchase-flow.spec.ts` (7/7 в prod-протоколе) | Контракт | GET-список/карточка/401 на purchase; **реальную покупку не выполняет** |

**Отсутствуют:** юнит-тесты всех мутаций marketplace (POST/PATCH/DELETE), purchase (кроме e2e-контракта 401), accept, recipe-stats, recipe-view-model; любые тесты медиа, порций, версий, импорта.

---

## C. Карта потоков данных

### C.1. Чтение каталога (работает)
`/recipes` → `recipes-catalog.tsx:81` csrfFetch → `GET /api/recipes/marketplace` → `supabaseAdmin.from("recipe_marketplace").eq("is_published", true)` (:76-86) → Postgres → `mapMarketplaceRowsToRecipes` (`recipe-view-model.ts:156`) → UI.

### C.2. Создание рецепта (только RECIPE_DEVELOPER)
Форма `CreateRecipeDialog` → `POST /api/recipes/marketplace` (dashboard:150-154) → requireRole → валидация → INSERT `recipe_marketplace` (route.ts:285-289). **Контент ингредиентов/шагов — заглушки (D5); фото — null.**
Путь кондитера: форма → `addRecipe` → `set({recipes: [...]})` (store.ts:663-673) → **конец. В БД не попадает, после reload исчезает.**

### C.3. Покупка (работает, без оплаты)
Кнопка «Купить» → POST `.../purchase` → идемпотент-проверка (:86-92) → расчёт royalty/commission (:104-105) → INSERT `recipe_purchases` (:119-131) → read-modify-write `purchases_count` (:142-147, неатомарно). Контент карточки при этом и так открыт всем (D4).

### C.4. Производственный расчёт (код работает, данные из вне)
Заказ → `order_items` (recipe_id × qty) → `computeIngredientNeeds` (breakdown.ts:205-387):
SQL A — `recipe_ingredients WHERE recipe_id = ANY(...)` (:221-228); SQL B — `inventory_items WHERE owner_id=$1 AND is_active` (:234-239); агрегация по inventory_item_id **или имени** (:296-300); конверсия `convertQty` (units.ts:87-93); дефицит → `Math.ceil(shortage_in_warehouse_unit) × cost_per_unit` (:352-360).

### C.5. Списание сырья (ручное, идемпотентное)
UI order-breakdown-dialog (:140-158) → `POST /api/inventory/write-off` → sha256 `item_id:qty` подпись (:60-70) → поиск в `inventory_write_offs` UNIQUE(owner,order,signature) → если новый: RPC `apply_inventory_movement_atomic` (0048: FOR UPDATE → проверка остатка → UPDATE quantity + INSERT movement) → запись в реестр. **Автоматического списания при производстве нет** (production/complete обновляет только completed_at, :69).

### C.6. «Принять рецепт» (сломан)
Карточка → POST `/api/recipes/[id]/accept` → валидация ОК → INSERT с 9 колонками, из которых 8 не существуют → **ошибка БД** → UI: «Не удалось создать подтверждение». Список acceptances: SELECT падает на `.eq("status","active")` → catch → audit_logs → при пустоте **MOCK_ACCEPTANCES**.

### C.7. Персистентность: сводная таблица

| Механизм | UI | Store | API | БД | Постоянное хранение | Статус |
|---|---|---|---|---|---|---|
| Публичный каталог/карточка | + | — | + | recipe_marketplace | Да | Работает |
| Создание рецепта (RECIPE_DEVELOPER) | + | — | + | recipe_marketplace | Да (контент-заглушки) | Работает |
| Редактирование рецепта | — | — | + (PATCH) | recipe_marketplace | Да | Endpoint без UI |
| Создание рецепта (кондитер) | + | **Zustand** | — | — | **Нет** (вне partialize) | Демо |
| Избранное/«Сохранить» рецепта | + | useState | — | — | Нет | Фикция |
| Покупка | + | — | + | recipe_purchases | Да | Работает (D3) |
| Принятие рецепта кондитером | + | — | + | recipe_acceptances | Нет (ошибка) | Сломан |
| Медиа рецептов | URL-строка в форме | — | — | uploads (Storage) + URL в JSONB | URL только | Частично |
| Нормы ингредиентов | — | — | — | recipe_ingredients | Да | Запись только вне приложения |

---

## D. Сопоставление с примером публикации («Жареный сыр»)

| # | Элемент примера | Поддержка | Чем и где |
|---|---|---|---|
| 1 | Название | **Поддерживается** | `title` recipe_marketplace (в форме — есть) |
| 2 | Вводное описание | **Поддерживается** | `description` |
| 3 | Галерея изображений | **Не поддерживается** | только `preview_image` (1 шт.); в форме разработчика фото-поля нет вообще |
| 4 | Происхождение изображений | **Не поддерживается** | нет полей origin/ai_generated; uploads-журнал (0015) не связан с рецептом |
| 5 | Ингредиенты | **Частично** | ingredients_json [{name, qty, unit}]; qty — **строка** в JSONB (live: `"150"`), числовой нормализации нет |
| 6 | Единицы измерения | **Частично** | свободный текст в JSONB; серверная конвертация только г/кг/мл/л/шт/дес (units.ts:27-64) |
| 7 | Количество ингредиента | **Частично** | дробные в JSONB возможны, но не нормализованы и не масштабируются |
| 8 | Порядок шагов | **Частично** | `step_number` в steps_json; drag-n-drop/порядок не редактируется (формы без шагов-редактора контента) |
| 9 | Время отдельного шага | **Не поддерживается** | шаг = {step_number, description, image?, video_url?} — поля времени нет |
| 10 | Температура и оборудование | **Не поддерживается** | — |
| 11 | Варианты ингредиентов (9 видов сыра) | **Не поддерживается** | — |
| 12 | Рекомендации по подаче | **Не поддерживается** | на UI «Рекомендации» захардкожены (recipe-detail-page.tsx:551-563), в БД поля нет |
| 13 | Соусы | **Не поддерживается** | (в целевой модели — группа ингредиентов «Соусы») |
| 14 | Хэштеги | **Поддерживается** | `tags TEXT[]` |
| 15 | Авторство | **Частично** | author_id есть; отображаемого имени автора в БД нет — UI ставит «Автор рецепта» |
| 16 | Источник (ссылка Telegram) | **Не поддерживается** | некуда положить; в целевой модели — recipe_sources, не текст шагов |
| 17 | Рекламный блок | **Не поддерживается** (и не должен храниться как часть рецепта) | целевое решение: блоки рекламы не входят в модель рецепта вообще; ссылка МК — в recipe_sources.source_meta |
| 18 | Права на повторное использование | **Не проверено** (в системе нет понятия) | целевое поле rights_confirmed в recipe_sources |

**Проверка сохранения этого рецепта в текущей системе:** ввести «Жареный сыр» с 4 ингредиентами и 5 шагами в реальную БД может только RECIPE_DEVELOPER, и то заглушками (D5). Кондитер/пользователь — никак (store-only). Значит — **нельзя без потери смысла**: галерея, варианты сыра, соусы, источники, время шагов и подача некуда поместить, а состав в JSONB не масштабируется и не связан со складом.

### D.9. Пример целевого JSON (реализация целевой модели, не существующий код)

```jsonc
{
  "recipe": {
    "title": "Жареный сыр",
    "subtitle": "Сырное блюдо для всей семьи",
    "description": "Кто не пробовал жареный сыр, тот многое потерял. Сохраните рецепт и приготовьте сырное блюдо для всей семьи",
    "category": "закуски", "tags": ["завтрак", "идея завтрака", "рецепт завтрака", "простые рецепты"],
    "language": "ru", "servings": 4,
    "access_type": "free",
    "status": "published",
    "source": {
      "source_type": "telegram", "source_url": "https://t.me/<канал>/<пост>",
      "source_author": "—", "source_published_at": null,
      "imported_at": "2026-11-08T12:00:00Z", "import_method": "ai_assisted",
      "rights_confirmed": true,
      "source_meta": { "promo_block": { "kind": "external_promo", "stored_in_recipe": false,
        "note": "Реклама мастер-класса не входит в рецепт; сохранена только в исходном payload" } }
    }
  },
  "ingredients": [
    { "position": 1, "group": null, "name": "Сыр",            "amount": 300, "unit": "г",  "display_qty": "300 г",  "is_optional": false, "prep_note": "нарезать пластинами 1 см", "substitutes": [
      { "name": "Халлуми", "amount": 300, "unit": "г" }, { "name": "Адыгейский", "amount": 300, "unit": "г" },
      { "name": "Сулугуни", "amount": 300, "unit": "г" }, { "name": "Моцарелла", "amount": 300, "unit": "г" },
      { "name": "Фета", "amount": 300, "unit": "г" },     { "name": "Камамбер", "amount": 300, "unit": "г" },
      { "name": "Гауда", "amount": 300, "unit": "г" },    { "name": "Бри", "amount": 300, "unit": "г" },
      { "name": "Соевый сыр", "amount": 300, "unit": "г" } ] },
    { "position": 2, "name": "Мука",                  "amount": 50,  "unit": "г",  "display_qty": "50 г" },
    { "position": 3, "name": "Яйцо",                  "amount": 3,   "unit": "шт", "display_qty": "3 шт." },
    { "position": 4, "name": "Панировочные сухари",   "amount": 50,  "unit": "г",  "display_qty": "50 г" }
  ],
  "ingredient_groups": [ { "position": 5, "title": "Для подачи (по желанию)", "ingredients": [
      { "name": "Тосты", "amount": null, "unit": "по вкусу", "display_qty": "по вкусу", "is_optional": true },
      { "name": "Овощи-гриль", "amount": null, "unit": "по вкусу", "is_optional": true },
      { "name": "Клюквенный соус", "amount": null, "unit": "по вкусу", "is_optional": true },
      { "name": "Брусничный соус", "amount": null, "unit": "по вкусу", "is_optional": true } ] } ],
  "steps": [
    { "position": 1, "description": "Сыр нарезать на пластины толщиной 1 см.", "time_min": 3 },
    { "position": 2, "description": "Яйца взбить, подготовить муку и сухари.", "time_min": 2 },
    { "position": 3, "description": "Обвалять сыр сначала в муке, потом в яйцах, затем в сухарях.", "time_min": 5 },
    { "position": 4, "description": "Разогреть сковороду с маслом, положить сыр на 1 минуту.", "time_min": 1, "temperature_c": 180, "equipment": ["сковорода"] },
    { "position": 5, "description": "Перевернуть сыр и выключить сковороду, подождать, пока дойдёт вторая половина сыра.", "time_min": 2 }
  ],
  "media": [
    { "type": "cover",         "position": 1, "origin": "imported", "ai_generated": false, "source": "telegram_post" },
    { "type": "result_photo",  "position": 2, "origin": "imported", "ai_generated": false },
    { "type": "gallery",       "position": 3, "origin": "ai_generated", "ai_generated": true, "caption": "Иллюстрация, сгенерированная ИИ" }
  ],
  "provenance_note": "Каждое извлечённое при импорте поле несёт метку: source | extracted | user_corrected | unknown. Количество/время/температура выше присутствуют в источнике; invented-значения запрещены."
}
```

---

## E. Проблемы и риски (точные координаты)

1. **D1** `src/app/api/recipes/[id]/accept/route.ts:140-155` — INSERT колонок `confectioner_id/price_from/price_to/prep_days/delivery/self_pickup/notes/status`, отсутствующих в `recipe_acceptances` (0010:146-155; live-схема подтверждена). Все 4 маршрута accept-семейства затронуты.
2. **D2** `acceptances/route.ts:284-286` — `rawAcceptances = MOCK_ACCEPTANCES` при пустом результате; фиктивные данные в проде.
3. **D3** `purchase/route.ts:108-116` — `payment_id` из body без валидации; платные рецепты покупаются бесплатно.
4. **D4** `marketplace/[id]/route.ts:55-59` — `select("*")` без проверки покупки: содержимое платного рецепта публично.
5. **D5** `recipe-developer-dashboard.tsx:607-608` — `steps_json: [{step_number:1, description:""}]`, `ingredients_json: [{name:"", qty:"", unit:"г"}]` — заглушки в БД.
6. **D6** `moderator/action/route.ts:37-45` — `tableMap` без `recipe`; `moderator-dashboard.tsx:36,106` шлёт type="recipe".
7. **D7** Дублирование полей title/description/time/difficulty между `recipes` (0010), `recipe_marketplace` (0012) и UI-типом `Recipe` (types.ts:929-982); slug и image в двух таблицах.
8. **D8** `recipe_ingredients` (0053) — ни одного INSERT/UPDATE в src/ (grep: только SELECT breakdown.ts:221-228); нормы вводятся только руками в БД.
9. **D9** Дублирующие расчёты: `breakdown.ts:352-360` (закупка дефицита), `rules.ts:509-513` (авточерновик, другая формула объёма), `supplier/dashboard/route.ts:152-155` (стоимость склада, сервер), `confectioner-extra-tabs.tsx:1050` (та же стоимость, клиент-дубль), `order-breakdown-dialog.tsx:135-138` (пропорциональная аппроксимация вместо convertQty — третий алгоритм единиц).
10. **D10** `write-off/route.ts:8-9` (собственный комментарий) — заказ не линкуется с рецептом; снапшота рецептуры в заказе/списании нет → правка `recipe_ingredients` после оформления заказа меняет расчёты задним числом.
11. **D11** `api/inventory/items PATCH :198-204`, `api/supplier/products PATCH :260-264` — прямой UPDATE quantity мимо `inventory_movements` (аудит-трейл обходится).
12. **D12** `marketplace/[id]/route.ts:88-92` и `purchase/route.ts:142-147` — read-modify-write счётчиков (race), вместо `... = views + 1`.
13. **D13** `confectioner-recipe-acceptances/route.ts:39-44` — сравнение `confectioner_id` с `user.id` (profiles), а не с `confectioners.id` (контраст: accept/route.ts:53-57 резолвит правильно).
14. **D14** store.ts:663 vs :1373 — два action'а создания рецепта с разными id-форматами; один живёт в мёртвом компоненте.
15. **D15** `inventory_movements.order_id` без FK (live-проверка); 0046/0049 — без RLS-политик.
16. **D16** UI-тип `Recipe` (types.ts:929-982) шире БД: likes/comments/servings/type — заглушки маппера; `expert`-сложность теряется (recipe-detail-page.tsx:44-48).

---

## F. Целевая модель данных

### F.0. Принцип

**Одна сущность контента — три уровня потребления.** Уровень A (публикация) и уровень B
(кулинарная рецептура) — это **один корень** `recipes` (контент+состав неразделимы: состав — часть
публикуемого рецепта). Уровень C (производство) — **отдельная производная сущность** (карта),
ссылающаяся на **неизменяемую версию** рецепта. Коммерческая оболочка (цена/роялти) остаётся
отдельным оффером, чтобы не смешивать контент с монетизацией. Ничего из существующего
механизма склада/списания не дублируется.

Ответы на обязательные вопросы:

- **Можно ли использовать существующую `recipes`?** Да — она становится единым корнем (расширяем, не дублируем). Она уже FK-цель для products/recipe_ingredients/acceptances.
- **Сохранять ли `recipe_marketplace` как отдельный коммерческий контур?** Да, но как **тонкий оффер-слой** (цена, роялти, премиум) со ссылкой `recipe_id → recipes(id)`. Покупки/роялти/RLS покупателя не трогаем — платная модель сохраняется целиком.
- **Можно ли нормализовать ingredients_json/steps_json без нарушения совместимости?** Да, поэтапно: нормализованные дети (`recipe_ingredients` уже есть, `recipe_steps` новые) + режим двойной записи на переход; старые читатели (breakdown, e2e-контракты) продолжают работать; JSONB-колонки замораживаются после переключения UI (удаление — отдельное решение владельца, не в RECIPE-02).
- **Как связать публичный рецепт с производственной картой?** `recipe_production_cards.recipe_version_id → recipe_versions(id)`; продукт ссылается на карту (`products.production_card_id`, nullable; `products.recipe_id` сохраняется для совместимости).
- **Как версионировать рецептуру?** Неизменяемые снапшоты в `recipe_versions` (полный normalized-снимок JSONB + version_no); publish создаёт версию; карта и списания ссылаются на version_id.
- **Как сохранить историю себестоимости?** `recipe_card_cost_history` (per card_version × computed_at, цены склада на момент расчёта в breakdown JSONB). Единственный калькулятор — серверный.
- **Как не допустить изменения выполненных заказов?** Выполненные заказы/списания хранят card_version_id и signature; исходная норма восстанавливается из снапшота версии, живые таблицы не читаются.
- **Перенос старых рецептов?** Бэкфилл: 3 строки marketplace → строки recipes (+recipe_id в офферах); 1 строка recipes — остаётся как есть (content MDX помечается legacy); steps/ingredients JSONB → дети скриптом двойной записи; черновики-заглушки D5 помечаются `quality_flag='stub'`.
- **Какие таблицы оставить без изменений?** `inventory_items`, `inventory_movements`, `inventory_write_offs`, RPC 0048, `order_production`(+checklist), `recipe_purchases`, `products` (кроме добавления nullable-колонки), `uploads`-журнал.

### F.1. `recipes` — расширение существующей (уровень A+B, корень)

| Поле | Тип | Примечание |
|---|---|---|
| **существующие остаются**: id, author_id, title, description, content, difficulty, prep/cook_time_minutes, servings, calories_per_serving, protein/fat/carb_g, tags[], category, image_url, video_url, slug UNIQUE, status, views/likes_count, published_at, created/updated_at | | статус-словарь расширяем: `draft/pending_review/published/rejected/archived` (CHECK) |
| `subtitle` | TEXT | короткая подводка |
| `access_type` | TEXT CHECK ('free','paid','subscription') DEFAULT 'free' | витринный признак; цена живёт в оффере |
| `allergens` | TEXT[] | коды (milk/eggs/gluten/nuts/peanuts/soy/fish/shellfish/sesame) |
| `equipment` | TEXT[] | «сковорода» и т.п. |
| `yield_text` | TEXT | «выход: 12 пластин» (человекочитаемый) |
| `storage_note` | TEXT | условия хранения/срок |
| `source_*` (4 поля) | TEXT/TIMESTAMPTZ | `source_type, source_url, source_published_at, imported_at` — денормализация главных полей `recipe_sources` для быстрого чтения (полный payload в recipe_sources) |
| `moderation_status` + `moderation_reason` | TEXT | унификация с products/reviews (та же схема модерации) |
| `legacy_content_mdx` | BOOLEAN DEFAULT false | метка контентного контура I |

Индексы: `status, published_at DESC`; GIN `tags`; триграммный индекс title (pg_trgm уже подключён).
RLS: как сейчас (select public/own, insert/update own) + политика модератора (ADMIN/SUPER_ADMIN all).

### F.2. `recipe_media` — новая (единая медиа-сущность)

`id UUID PK · recipe_id FK recipes CASCADE · type CHECK IN ('cover','gallery','result_photo','cross_section','step','video','ai_preview') · url TEXT · storage_path TEXT · position INT · caption TEXT · origin CHECK ('author_upload','imported','ai_generated') · ai_generated BOOL · step_id FK recipe_steps SET NULL (фото этапа) · alt_text TEXT · created_at`

Индекс `(recipe_id, position)`; частичный `WHERE ai_generated` для фильтра «не считать ИИ-фото доказательством реального блюда». RLS: write — автор рецепта/админ; read — как родительский рецепт. Заменяет URL-строки в JSONB и «coverImage в форме строкой». Фотография готового изделия и разреза — разные `type` (требование карточки кондитера сохраняется).

### F.3. `recipe_ingredients` — расширение существующей

Остаются: id, recipe_id FK, name, qty numeric(12,3), unit, inventory_item_id FK SET NULL, sort_order.
Добавляются: `display_qty TEXT` («1/2 стакана», «по вкусу») · `amount INTEGER NULL`-режим: **qty делается NULLABLE** («по вкусу»/«по необходимости» без числа) · `is_optional BOOL DEFAULT false` · `prep_note TEXT` («нарезать пластинами 1 см») · `group_title TEXT` (простые группы без отдельной таблицы: «Тесто», «Соусы», «Для подачи») · `position INT`.

Единицы: канон — г/мл/шт (как в units.ts); «ложка/стакан/упаковка/по вкусу» — **display-only** (не конвертируются без плотности; convertQty возвращает null → в производственном контуре такая позиция требует явной привязки к складской позиции с единицей). `recipe_ingredient_groups` как отдельная таблица **не создаётся** до реальной потребности (иерархии/переиспользования групп между рецептами) — justify: YAGNI, group_title покрывает пример.

### F.4. `recipe_ingredient_substitutes` — новая

`id · ingredient_id FK recipe_ingredients CASCADE · name · qty numeric NULL · unit · position` — варианты замены (9 видов сыра в примере). RLS по родительскому рецепту.

### F.5. `recipe_steps` — новая (нормализация steps_json)

`id · recipe_id FK CASCADE · position INT · title TEXT · description TEXT NOT NULL · time_min INT · time_max INT · temperature_c INT · tips TEXT` + медиа через `recipe_media.step_id`. Индекс `(recipe_id, position)` UNIQUE. RLS по родителю.

### F.6. `recipe_variants` — новая (варианты рецепта)

`id · recipe_id FK CASCADE · title («На халлуми») · description · is_default BOOL · overrides JSONB` — overrides = [{ingredient_id, action: replace|add|remove|set_qty, name?, qty?, unit?}]. Сервинга/порции варианта: `servings INT NULL`. Прагматичное JSONB-ядро с нормализацией по потребности (RECIPE-04/05 покажет, нужен ли child-table).

### F.7. `recipe_sources` — новая (происхождение и права)

`id · recipe_id FK CASCADE · source_type CHECK ('telegram','vk','site','document','manual') · source_url · source_author · source_published_at · imported_at · import_method ('ai','manual') · raw_payload JSONB (исходник для аудита) · rights_confirmed BOOL · rights_note · created_at`. UNIQUE(recipe_id, source_url). Рекламные блоки — только внутри raw_payload, никогда не в steps/ingredients.

### F.8. `recipe_versions` — новая (версионирование)

`id · recipe_id FK · version_no INT · created_by · created_at · changelog TEXT · snapshot JSONB (полный normalized-снимок) · origin CHECK ('publish','production_approve','manual')` · UNIQUE(recipe_id, version_no). Иммутабельность: без UPDATE-политик RLS вообще.

### F.9. `recipe_production_cards` — новая (уровень C)

`id · confectioner_id FK profiles · recipe_id FK recipes · recipe_version_id FK recipe_versions (норма зафиксирована) · product_id FK products NULL (1:1 факультативно) · title · status CHECK ('draft','approved','archived') · approved_by/approved_at · batch_yield_qty numeric · batch_yield_unit · portions_per_batch INT · created/updated_at` · UNIQUE(confectioner_id, product_id) WHERE product_id NOT NULL.

### F.10. `recipe_production_ingredients` — новая (нормы сырья карты)

`id · card_id FK CASCADE · source_ingredient_id FK recipe_ingredients NULL (публичный ингредиент-прототип) · inventory_item_id FK inventory_items RESTRICT (конкретная складская позиция; при approve — NOT NULL) · qty_per_unit numeric (норма на 1 изделие) · qty_per_batch numeric · unit · brutto_qty numeric NULL · waste_pct numeric DEFAULT 0 · is_optional BOOL`. **«Мука» в публичном рецепте ≠ «Мука пш. в/с, поставщик X»** — связь только здесь, с конкретикой.

### F.11. `recipe_card_cost_history` — новая (история себестоимости)

`id · card_id FK · card_version_id FK · computed_at · cost_per_unit_kopecks BIGINT (целые минимальные единицы) · cost_per_batch_kopecks BIGINT · breakdown JSONB (позиции: item, qty, unit, unit_price, cost) · price_basis ('inventory_current','inventory_at') · created_by`. Записывается серверным калькулятором при approve/recompute. **Деньги — только целые** (текущий cost_per_unit INTEGER рублей фиксируется как известное ограничение; переход на копейки — решение владельца, вне RECIPE-02).

### F.12. Что НЕ создаётся

`recipe_nutrition` (колонок recipes достаточно), `recipe_allergens` (TEXT[] колонка), `recipe_equipment` (TEXT[]), `recipe_ingredient_groups` (group_title), `recipe_step_media` (recipe_media.step_id), параллельные складские сущности, параллельные покупки.

---

## G. Целевая архитектура API

**Сохранить как есть:** `GET /api/recipes/marketplace` (поиск/фильтры/сортировка), purchase-контур (после D3/D4-фиксов), `/api/upload` (не трогаем), весь inventory-контур, `/api/confectioner/recipe-stats`.

**Расширить:** `marketplace/[id]` GET — гейтить steps/ingredients по покупке (D4), отдавать метаданные всем; PATCH — донавесить на новый корень.

**Новый единый CRUD (вместо трёх контуров):**
- `POST /api/recipes` — черновик (роли: RECIPE_DEVELOPER, CONFECTIONER, HOME, BUSINESS; серверная валидация состава, никаких цен с клиента);
- `GET/PATCH/DELETE /api/recipes/[id]` — владелец/админ; DELETE = soft (status='archived'), восстановление = PATCH status;
- `POST /api/recipes/[id]/publish` · `POST /api/recipes/[id]/unpublish` — публикация создаёт recipe_version;
- `POST|DELETE /api/recipes/[id]/media` · `/ingredients` · `/steps` (или PATCH составными DTO за один запрос — предпочитаемо для атомарности);
- `GET /api/recipes/[id]/versions` · `POST /api/recipes/[id]/scale` (серверный пересчёт порций, только display-ответ);
- `GET /api/recipes/[id]/acceptances` — переписать на рабочую схему (или миграция таблицы — решение RECIPE-02), убрать мок;
- `POST /api/recipes/import` — RECIPE-06 (после извлечения — обычный подтверждаемый черновик);
- производственный: `POST /api/production/cards` · `POST /api/production/cards/[id]/approve` (снапшот версии + cost_history) · `POST /api/production/cards/[id]/write-off-plan` (строит батч и передаёт в существующий `/api/inventory/write-off` с order_id=null→batch-signature режимом).

**Объединить/выключить:** вкладку кондитера перевести с store на `/api/recipes` (тот же компонент-менеджер, другой transport); store-actions addRecipe/createRecipe/updateRecipe/deleteRecipe удалить; MOCK_ACCEPTANCES удалить; PATCH-заглушкам формы разработчика дать настоящий редактор.

**Правило видимости себестоимости:** все поля карт/норм/цен возвращаются только владельцу карты (или ADMIN); публичные API никогда не включают production-поля (whitelist-сериализация на сервере).

---

## H. Роли и права доступа

| Действие | CUSTOMER | HOME | BUSINESS | ENTERPRISE | SUPPLIER | RECIPE_DEVELOPER | CONFECTIONER | ADMIN | SUPPORT |
|---|---|---|---|---|---|---|---|---|---|
| Читать опубликованные рецепты | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Создавать личные черновики | ✔ | ✔ | ✔ | ✔ | — | ✔ | ✔ | ✔ | — |
| Публиковать в общий каталог | — | ✔ (free) | ✔ | ✔ | — | ✔ | ✔ (после RECIPE-04) | ✔ | — |
| Публиковать платный оффер (роялти) | — | — | — | — | — | ✔ | — (v1; решение вынести отдельно) | ✔ | — |
| Покупать платные рецепты | ✔ | ✔ | ✔ | ✔ | — | ✔* | ✔ | ✔* | — |
| Редактировать/удалять свои рецепты | свои | свои | свои | свои | — | свои | свои | все | — |
| Модерировать | — | — | — | — | — | — | — | ✔ | read-only |
| Видеть закрытые рецептуры/себестоимость | — | — | — | — | — | свои | **только свои карты** | ✔ | — |
| Создавать/править производственные карты | — | — | ✔ | ✔ | — | — | ✔ | ✔ | — |
| Менять нормы сырья/списывать | — | — | владелец склада | владелец | — | — | владелец | ✔ | — |

*покупать своё — запрещено (уже реализовано в purchase/route.ts:78-83). SUPPLIER не получает доступ к рецептурному контенту (изоляция B2B). Серверные проверки: requireRole + ownership в каждом route; RLS — вторая линия (для браузерных supabaseBrowser-запросов).

---

## I. Связь с производством

1. **Сущности ТК нет** — подтверждено grep'ом (0 вхождений production_card/tech_card в миграциях/src, кроме worklog). Роль ТК исполняют: `recipes.content` (текст), `recipe_ingredients` (нормы на единицу товара, 0053:132-141 — qty в единицах unit «НА ОДНУ ЕДИНИЦУ товара»), `production_duration` (только время).
2. **Связь со складом реально существует, односторонняя и только для расчёта дефицита**: FK `recipe_ingredients.inventory_item_id` (live-проверка) + чтение склада владельца в breakdown.ts:234-239 + фолбэк по имени :296-300. Себестоимость изделия из этой связки **не считается** — только стоимость закупки дефицита.
3. **Списание**: единственный атомарный путь — RPC 0048 (`FOR UPDATE`, insufficient-guard) + реестр 0049 (UNIQUE owner+order+signature). Вызывается **только вручную** из диалога разбора заказа; lifecycle производства (start/complete) склад не трогает (production/start:78, complete:69 — только временные метки).
4. **Единицы**: серверный словарь units.ts (г/кг/мл/л/шт/дес); в UI-диалоге списания — третья, пропорциональная аппроксимация (D9.5). Брутто/нетто/потери отсутствуют (grep = 0).
5. **Целевая интеграция** (RECIPE-05): норма карты (`qty_per_unit` × партия) → план списания → существующий write-off (существующий RPC и реестр — без дублей); при production/complete — опциональный серверный вызов того же плана, только если у позиции заказа есть card_version_id. Публичный рецепт **никогда не списывает сырьё сам**.

---

## J. UX-предложения (карта изменений, не редизайн)

**Каталог:** большая обложка (aspect 4:3, object-cover), ягодный акцент только на цене/CTA; фильтры: серверные (q/tag/difficulty/доступ) вместо клиентских; пагинация/бесконечная прокрутка (limit+offset уже умеет API); бейдж «ИИ-иллюстрация» на ai_generated-обложках.

**Детальная страница:** hero-галерея (cover + result_photo + cross_section как разные слайды); блок ингредиентов с group_title-заголовками, `display_qty` крупно, чек-тогглы, степпер порций = серверный scale (числа из numeric, «по вкусу» не трогаем); нумерованные шаги с фото этапа и time_min/temperature; варианты — селектор «Сыр: халлуми/адыгейский/…» (recipe_variants/подstitutes); блок «Источник» со ссылкой на оригинал; рекламные блоки из источника не отображаются.

**Редактор (единый для кондитера и автора):** шаги: ингредиент-автокомплит по справочнику (fillings-справочник уже в сторе как справочник, store.ts:687-комментарий «не демо-записи»), amount numeric + unit-селектор + display_qty, флаг optional, prep_note; drag-n-drop шагов (существующий паттерн undo/redo конструктора, Z-v15); медиа — через существующий `/api/upload` (category=recipe) с прогрессом и ретраем (сейчас ошибки глотаются, lessons-tab:125); предпросмотр = детальная страница в read-only; черновик автосохраняется на сервере (не в store).

**Кабинет:** вкладку «Рецепты» кондитера перевести на API (список своих через `author_id`), убрать бейдж из store-счётчика (confectioner-dashboard.tsx:294); мёртвый `ConfectionerRecipesTab` удалить.

Мобильные фиксы: форма времени `grid-cols-4` → 2×2 на <sm (manager:442); таблица покупок разработчика → карточки на <md.

---

## K. План реализации

### RECIPE-02 — Унификация модели и БД
Объём: расширение `recipes` (F.1); новые `recipe_media, recipe_ingredient_substitutes, recipe_steps, recipe_variants, recipe_sources, recipe_versions, recipe_production_cards, recipe_production_ingredients, recipe_card_cost_history`; расширение `recipe_ingredients`; `recipe_marketplace.recipe_id` + бэкфилл; RLS всех новых таблиц; типы supabase. Миграции: 0065+ (0064 не трогаем).
Файлы: `supabase/migrations/*`, `src/lib/supabase/types*.ts`, `src/lib/types.ts`.
Зависимости: согласование владельцем; блокер B1 (0064) должен быть устранён владельцем до применения любых новых миграций на чистой БД — иначе setup падает раньше.
Риски: бэкфилл офферов; совместимость breakdown (recipe_ingredients qty NULL — обновить SQL-агрегацию, `qty IS NOT NULL` фильтр).
Тесты: миграции на чистой тестовой БД; бэкфилл-скрипт idempotent.
Приёмка: setup зелёный на чистой БД (включая 0064 после её фикса); все существующие vitest зелёные; live-схема соответствует ожидаемой.

### RECIPE-03 — Серверная логика и API
CRUD /api/recipes + publish/unpublish + versions + media/ingredients/steps DTO + scale; фиксы D1–D4, D6, D12, D13; переводы вкладки кондитера и дашборда разработчика на новые API; удаление мок-фолбэков и store-слоя рецептов.
Тесты: юнит-тесты на все маршруты (позитив/негатив: чужой id → 403/404, публикация без владения, покупка без оплаты платного → 402, scale не мутирует исходник), идемпотентность publish (версия не плодится).
Приёмка: e2e-контракт recipe-purchase-flow не сломан; новые контракты покрыты тестами; RLS-тесты.

### RECIPE-04 — Интерфейс
Каталог (серверные фильтры, пагинация), детальная (галерея, группы ингредиентов, порции, варианты, источник, шаги с медиа), единый редактор (ингредиенты/шаги/медиа/предпросмотр/черновик), мобильные фиксы J.
Приёмка: сценарии §14.1–14.16 в E2E; Lighthouse-мобилка без горизонтального скролла.

### RECIPE-05 — Производственные рецептуры
Карты + нормы + approve(версия) + единый калькулятор себестоимости (F.11) + план списания через существующий write-off; history; связь products.production_card_id.
Риски: перевод cost_per_unit в копейки — отдельное решение; подтверждение владельца на автосписание при complete.
Приёмка: сценарии §14.22–14.27; повторное списание невозможно (signature + card_version); себестоимость воспроизводима из history.

### RECIPE-06 — Импорт и ИИ
`POST /api/recipes/import`: fetch с SSRF-защитой (только https, блок приватных CIDR, лимит редиректов ≤3, таймаут, размер), извлечение структуры LLM (z-ai-web-dev-sdk, backend-only) с provenance-метками source/extracted/user_corrected/unknown, запрет придумывания количеств/времени/температуры (unknown вместо invention), медиа — перезалив через /api/upload с origin=imported/ai_generated, подтверждение пользователем до сохранения (черновик), рекламные блоки — только в raw_payload.
Приёмка: сценарии §14.17–14.19; XSS-фильтрация извлечённого HTML; e2e на примере «Жареный сыр».

### RECIPE-07 — Приёмка
Полный тест-набор §14 (28 сценариев), миграции на чистой БД (0064 уже исправлена к этому моменту), E2E на реальном браузере, security-ревизия (пейволл, RLS, SSRF, tenancy), регрессия: товары (recipe_id), заказы, склад (идемпотентность), платежи, платный маркетплейс (покупка→роялти).

---

## L. Регрессионные риски

| Зона | Риск | Защита |
|---|---|---|
| `products.recipe_id` (FK → recipes) | перенос контента в новый корень меняет семантику ссылки | `recipes` остаётся корнем — FK не переезжает; только nullable `products.production_card_id` добавляется |
| `recipe_ingredients` / breakdown | qty→NULLABLE ломает агрегацию | SQL-фильтр `qty IS NOT NULL`; регресс-тест breakdown |
| Платный маркетплейс | оффер-слой меняет чтение каталога | покупка/роялти не трогаются; каталог в переходный период читает marketplace как сейчас, гибридный рендер за фиче-флагом |
| Публичный e2e `recipe-purchase-flow` | контракт ответов | поля ответа не переименовывать на этапе 02–03; contract-тесты |
| Модерация | recipes.status значения | CHECK-словарь с бэкфиллом ('published' сохранён) |
| Склад/списание | новые пути списания | только через существующий write-off + RPC; никаких прямых UPDATE quantity |
| Платежи | гейт контента (D4) меняет публичный ответ | гейт вводится с флагом и для уже купленных (recipe_purchases) — проверка на сервере |
| Заказы задним числом | версии рецептов | снапшоты recipe_versions; живые таблицы для выполненных заказов не читаются |

---

## M. Непроверенные вопросы (и причины)

1. **Фактическое поведение «принять рецепт» на живом запросе** — статически доказано (колонок нет), но живой POST не выполнялся: это мутация (запрещено §2.3). Схема подтверждена интроспекцией и types.generated.ts:7584-7593.
2. **RLS под реальной GoTrue/сапабиз-сессией** (браузерный путь дашборда разработчика) — требуется живая аутентификация пользователя; в аудите проверены только политики и серверные маршруты.
3. **Docker/CI-прогон** — docker в песочнице отсутствует; `next build` запрещён ограничениями среды.
4. **Поведение Meilisearch** — сервис не поднят в песочнице; вывод о «мёртвом» индексе — из кода (нет синка рецептов).
5. **Правовые аспекты перепубликации** (права на контент из Telegram/VK) — вне технического аудита; поле rights_confirmed спроектировано, но политика заполнения — решение владельца.
6. **Мобильное приложение** (mobile-app/) — рецептов не содержит (проверено grep'ом store), глубже не исследовалось, т.к. рецептурного UI там нет.
7. **Ограничение B1**: миграция 0064 остаётся незаплатанной (владелец не исправлял, RECIPE-01 не трогал). Она не влияет на рецептурные таблицы, но блокирует чистый setup БД для будущих этапов — устранить владельцем до RECIPE-02.

---

*Аудит выполнен без изменений кода, миграций, БД и Git-состояния. Единственный артефакт — настоящий документ.*
