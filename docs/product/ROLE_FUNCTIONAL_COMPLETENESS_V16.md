# ROLE FUNCTIONAL COMPLETENESS — Z-v16

**Дата:** 2026-11-08 · **HEAD:** `7eaade1` (main, без push) · **Базовый коммит Z-v14:** `122fa3c` · **Z-v15:** `98c0ddc`

Метод: инвентаризация по исходникам (5 независимых проходов: CUSTOMER; HOME/BUSINESS/ENTERPRISE; SUPPLIER/DECOR/ANIMATOR; COURIER/ADMIN/SUPPORT; БД/auth/сквозные механизмы), проверка 6 сквозных сценариев, браузерная приёмка реализованного P0-блока. Никакие DONE/READY-отчёты не принимались как доказательства — только код, API и БД.

---

## 1. Фактическое состояние проекта

- Ветка `main`, HEAD `7eaade1eef5e09255a5d5984561846df58a18a8d`, рабочий без изменений до реализации Z-v16, все коммиты локальные (origin/main…HEAD — весь проект не опубликован).
- История: Z-v13 `bb44d35` → Z-v14 `122fa3c` (CAS PATCH, dedupKey ORDER_CONFIRMED) → Z-v15 `98c0ddc` (undo/redo конструктора). Планируемых изменений после `122fa3c` вне задач Z-v15/Z-v16 не обнаружено.
- 4 защищённых upload-файла **на диске** (`git ls-files -v` → `H`, skip-worktree не активен), redline-paths 9/9 PASS — известный дефект Z-v14 (4 fail из-за отсутствия файлов) закрыт в предыдущей сессии.
- 63 миграции Supabase, ~180 таблиц; 30 ролей в enum `user_role` (0001 + 0012).
- Стек: Next.js 16 App Router + app-JWT (`lib/auth.ts`), серверные проверки ролей (`lib/role-guards.ts`), PostgREST-шим над pg.Pool (`lib/postgrest/*`), socket.io chat-server :3030, SimpleX-мост, YooKassa, n8n.
- Тестовая база на момент старта Z-v16: vitest 90 файлов, **1390 тестов**; Playwright 9 спеков (~151); python e2e по 6 ролям.

**Ключевой вывод Z-v16:** ядро маркетплейса (заказы, оплата, эскроу, склад, чат, уведомления, RBAC, антифрод) — реальное и протестированное. Но карта зрелости крайне неровная: B2C «покупатель↔кондитер» доведён до F/E, а 6 из 10 ролей не имеют сквозного цикла (SUPPLIER заблокирован отсутствием профиля, DECOR и услуги ломают checkout, курьер не может взять заказ из UI, поддержка не получала эскалаций, админ управляет заказами через мок).

## 2. Полный перечень ролей

Enum `user_role` (30): CUSTOMER, CONFECTIONER, ADMIN, SUPER_ADMIN, COURIER, SUPPLIER, VENUE_OWNER, ANIMATOR_AGENCY, RECREATION_CENTER, KIDS_CLUB, GUEST, MODERATOR, SUPPORT, STUDIO, BLOGGER, TASTER, FRANCHISEE, NUTRITIONIST, CORPORATE_CLIENT, QUALITY_INSPECTOR, CERTIFICATION_AGENT, COPYWRITER, FOOD_SERVICE, EVENT_ORGANIZER, PICKUP_POINT, WHOLESALER, INSPECTOR, RECIPE_DEVELOPER, LOYALTY_PARTNER, AI_ASSISTANT.

Анализ ниже — по 10 продуктовым ролям задания. Роли без собственного кабинета/контура (BLOGGER, TASTER, NUTRITIONIST, CERTIFICATION_AGENT, COPYWRITER, RECIPE_DEVELOPER, LOYALTY_PARTNER, AI_ASSISTANT, PICKUP_POINT, GUEST) — либо точечные фичи, либо перечислены в UI-дашбордах на константах; в матрицу не включены, отмечены в backlog P2/P3.

## 3–4. Матрица функциональной зрелости (A–F)

Легенда: **A** отсутствует · **B** UI only · **C** partial · **D** backend ready, нет UI/интеграции · **E** functional без полного покрытия · **F** verified (UI+API+БД+тесты).

### 3.1 CUSTOMER

| Функция | UI | API/DB | Статус | Источники |
|---|---|---|---|---|
| Регистрация/вход/профиль/адреса | auth-modal, profile-settings | auth/*, profile/*; profiles, addresses, 2FA, anti-fraud | **F** | src/components/layout/auth-modal.tsx; src/app/api/auth/*; src/app/api/profile/* |
| Поиск/фильтры/сортировка | catalog-page (клиентские над снимком 60) | /api/products (серверные параметры есть, UI не использует), /api/search (Meilisearch — мёртв) | **C** | src/components/pages/catalog-page.tsx; src/app/api/products/route.ts; src/app/api/search/route.ts |
| Карточка товара (фото/состав/срезы) | product-page + галерея | /api/products/[id] (+media/slices/similar); product_media (0052) | **F** | src/components/pages/product-page.tsx; src/app/api/products/[id]/* |
| Сравнение товаров | compare-режим каталога + AI-диалог | /api/ai/compare; не персистится | **C** | src/components/ai/ai-compare-dialog.tsx; compare-drawer.tsx — мёртвый код |
| Избранное | сердечки каталога → **localStorage**; дашборд → сервер | /api/wishlist + product_favorites | **C (split-brain)** | src/components/products/product-card.tsx:40; src/app/api/wishlist/route.ts |
| Профиль кондитера/портфолио | /confectioners/[slug] (SSR) | /api/confectioners | **E** | src/app/confectioners/[slug]/page.tsx |
| Индивидуальный заказ (quotes) | отправка из конструктора работает | /api/quotes POST; **GET ?mode=my не потребляется UI**, вкладка «Согласование» — mock-стор | **C** | src/app/api/quotes/route.ts; src/components/dashboard/negotiation-tabs.tsx |
| Конструктор торта | 9 шагов, undo/redo (Z-v15) | серверная валидация формулы, fillings fail-closed | **F** | src/components/cake-builder/cake-builder-page.tsx; src/lib/cake-builder-pricing.ts |
| Корзина | cart-drawer | серверное зеркало cart_items (0062), merge, владение | **F** | src/lib/cart-sync.ts; src/app/api/cart/* |
| Доступность/сроки доставки | checkout-availability | /api/orders/availability + гейт 422 (acceptance engine) | **F** | src/app/api/orders/availability/route.ts; src/lib/ops/acceptance.ts |
| Расчёт стоимости | cart/checkout | серверный пересчёт, снапшоты тарифа | **F** | src/lib/finance.ts; src/app/api/checkout/route.ts |
| Промокоды | поле в корзине | promo-codes серверная истина; клиентский превью не знает fixed/free_delivery | **E** | src/lib/promo-codes.ts |
| Оформление и оплата | checkout 3 шага, idempotency | YooKassa + эскроу + webhook (HMAC, сверка, CAS) | **F** | src/app/api/checkout/route.ts; src/app/api/payment/webhook/route.ts |
| Статусы/история заказа | дашборд + timeline | /api/orders/[id]/timeline; CAS-переходы | **F** | src/app/api/orders/[id]/route.ts |
| Чат с кондитером | chat-widget | chat_channels + socket.io | **F** | src/components/chat/chat-widget.tsx |
| Отмена заказа | кнопка дашборда | /api/orders/[id]/cancel (возврат YooKassa) | **F** | src/app/api/orders/[id]/cancel/route.ts |
| Изменение заказа (состав/дата) | — | **нет** | **A** | — |
| Возврат/претензия | RefundRequestDialog, ProblemOrderDialog | /api/payment/refund (заявка), /api/crm/tickets | **E** | src/app/api/payment/refund/route.ts |
| Уведомления | колокол, push, prefs | /api/notifications + dedupKey | **F** | src/lib/notifications.ts |
| Отзывы | диалог после доставки | /api/reviews (UNIQUE order, 0057); **страница /reviews — мок** | **C** | src/app/api/reviews/route.ts; extra-pages.tsx:2905 |
| Повторный заказ | «Повторить» | /api/orders/[id]/repeat | **E** | src/app/api/orders/[id]/repeat/route.ts (нет тестов) |
| История покупок | дашборд | GET /api/orders **без пагинации** | **C** | src/app/api/orders/route.ts |

**Критические пробелы CUSTOMER:** split-brain избранного (сердечки не попадают на сервер → рекомендации их не видят); незакрытый цикл индивидуального заказа (ответы кондитеров покупатель не видит); два несовпадающих дашборда (customer-dashboard v1 vs customer-dashboard-v2); заказ декора/услуг ломает checkout (см. DECOR/ANIMATOR); нет изменения заказа; нет пагинации истории; /reviews и кнопка «Поделиться» — фикция.

### 3.2 HOME (домашний кондитер)

| Функция | Статус | Источники / комментарий |
|---|---|---|
| Регистрация/профиль/модерация | **F** | onboarding + DaData-автоаппрув + admin approve/reject; confectioner-gate fail-closed |
| Портфолио | **E** | POST /api/confectioner/portfolio; нет delete/reorder; медиа карточек — только у админа |
| Каталог товаров | **C** | catalog-manager на реальных API; product_variants (0006) — таблица-сирота; начинки-модификаторы не пишутся |
| Индивидуальные предложения | **C** | inquiries реальные; «Согласование» — mock-стор; две параллельные системы quotes (0004 vs 0023) |
| Получение заказов, accept/reject | **F** | accept-гейт (Acceptance Engine), CAS, dedup-уведомления |
| Чат с покупателем | **E** | реальный; модерация чата отдельно |
| Календарь загрузки | **C** | вкладка — mock; capacity-движок (0054, EXCLUDE) реальный, но **конфигурации своей ёмкости нет** (нет API/UI записи confectioner_capacity) |
| Рецепты/техкарты | **C** | чтение recipe_ingredients есть, **создать техкарту нечем** (нет CRUD рецептов кондитера) |
| Ингредиенты/ед. изм. | **E** | inventory/items CRUD + units.ts (тест) |
| Себестоимость | **C** | cost_per_unit на складе; калькулятора «рецепт→цена» нет |
| Цена/маржинальность | **B** | только regional pricing; маржа не считается |
| Склад | **F** | RPC apply_inventory_movement_atomic (0048), журнал 0046 |
| Автосписание по рецепту | **C** | осознанно ручное: /api/inventory/write-off (идемпотентность 0049), связи order↔recipe в БД нет |
| Нехватка сырья | **E** | LOW_STOCK rule + n8n + breakdown + блок accept |
| Производство | **D→C** | движки lifecycle/capacity/risk/production полные (0054); вкладка Gantt — mock; назначение — только админ |
| Готовность/передача | **E** | ready-гейт (чеклист+фото), handoff |
| Закупки | **E** | purchase-drafts авто из дефицита; реестра/статусов в UI нет |
| Финансовая история | **C** | /api/payouts/request боевой (2FA, CAS, резерв); UI-кнопка disabled, баланс из мока; confectioner_transactions не подключён |
| Аналитика продаж | **E** | analytics-compute по реальным заказам; bento-метрики частично мок |
| Отзывы/рейтинг | **C** | API реальные; вкладка и шапка — мок; ответов на отзыв нет |
| Уведомления | **E** | колокол реальный; вкладка напоминаний — мок |

### 3.3 BUSINESS (профессиональный кондитер)

**Уровень практически не существует как отдельный.** Роль одна — CONFECTIONER; `confectioners.business_scale` (0055: home/business/enterprise) меняет только вид вкладки «Сегодня» (4 файла ссылаются на поле), `tariff` — только комиссию (8% BUSINESS).

| Функция | Статус | Комментарий |
|---|---|---|
| Сотрудники | **B (backend сломан)** | api/team/{members,tasks,events} пишут snake_case в camelCase-таблицы 0017 → PGRST204 на каждом запросе; accept-invite нет; UI — канбан на моке |
| Роли/права внутри организации | **A** | organization/* — только DaData-верификация ИНН; organization_id нигде нет |
| Разделение заказов | **C** | assign/reassign (ADMIN-only, Assignment Engine с 0054) — между кондитерами платформы, не сотрудниками |
| Мощности/загрузка | **C** | движок реальный; конфигурации нет |
| Несколько рабочих зон | **A** | нет сущности; inventory_items без location |
| Централизованные рецепты/склад | **A** | owner_id жёстко user.id во всех inventory-роутах |
| Закупки/поставщики | **C** | черновики есть; связи с поставщиком нет |
| CRM клиентов | **B/C** | вкладка кондитера — мок; api/crm/leads — **утечка: CONFECTIONER видел все лиды платформы (закрыто в Z-v16)** |
| Акции | **B** | UI-мок; CRUD своих акций нет |
| Аналитика по сотрудникам | **A** | сотрудников нет |
| Финансовая отчётность | **C** | payout-пайплайн реальный; налоговый таб — мок; financial_ledger (0063) без UI чтения |
| Контроль качества | **C** | QUALITY_INSPECTOR + cron; UI-контура претензий у кондитера нет |

### 3.4 ENTERPRISE

| Функция | Статус |
|---|---|
| Несколько подразделений/точек | **A** (franchise_points — про франшизу, не связаны) |
| Склад по площадкам | **A** (0048/0049 — атомарность/идемпотентность, не мультисклад) |
| Перемещение сырья | **A** (movements только IN/OUT/ADJUST) |
| Производственные задания | **C** (ops_tasks + чеклисты работают, но без «подразделений/смен») |
| Централизованные закупки | **C** (purchase_drafts строго owner-скоуп) |
| Отчётность по подразделениям | **A** |
| Журнал операций | **C** (domain_events/audit_log пишутся; чтение — только в админ-ops) |
| Контроль действий сотрудников | **A** (сотрудников нет) |
| «Operations Center» при enterprise | **B** — единственный эффект business_scale: другой вид одной вкладки |

**Вывод:** ENTERPRISE — это маркетинговая опция в настройках. Реализация — отдельный этап продукта (нужна сущность организация/площадка), в первом проходе не трогать.

### 3.5 SUPPLIER

| Функция | Статус | Комментарий |
|---|---|---|
| Профиль компании/реквизиты | **C (заблокирован)** | `supplier_profiles` **никем не создаётся** → новый поставщик получает 404 навсегда; каталог POST закрыт гейтом isActive |
| Модерация поставщика | **A** | approve только для кондитеров |
| Каталог продукции | **E внутр. / B витрина** | /api/supplier/products реальные (в inventory_items); /supplier-shop — 100% mock |
| Оптовые цены | **D** | wholesale_prices (0017) читается b2b/*, **API записи нет** — каталог пуст без ручного seed |
| Мин. объём заказа | **C** | поле в схеме; нигде не проверяется |
| Остатки | **E** | менеджер реальный; /api/supplier/warehouse — **schema mismatch + orphan** |
| Сроки/география | **A** | только STUB_DATA в /api/supplier/dashboard |
| Коммерческие предложения | **A** | — |
| Запросы от кондитеров | **A** | inquiries/negotiations жёстко confectioner-only |
| Обработка заказов | **C** | read-only из orders.confectioner_id (чужие заказы!); B2B-заказы с confectioner_id=null поставщик не видит |
| Документы/счета | **A** | payment_method='invoice' — строка |
| Продажи/аналитика | **C** | revenue = стоимость склада (proxy) |
| Коммуникация/претензии | **A** | — |

**Критично:** роль выдаётся при регистрации, работать не может (S-1). Кабинет содержит админские табы (Anti-fraud, верификация кондитеров) → ошибки.

### 3.6 COURIER

| Функция | Статус | Комментарий |
|---|---|---|
| Профиль/документы | **C** | courier_profiles (0017) **никем не создаётся**; UI захардкожен |
| Верификация/активация | **A** | роль выдаётся при регистрации свободно |
| Статус доступности | **A** | поле в схеме без API |
| Список доступных доставок | **D** | GET /api/courier/available-orders работает — **UI «биржи» нет** |
| Принятие задания | **D** | POST /api/courier/assign — атомарный клейм (is null optimistic lock) — **UI нет, тестов нет** |
| Доступ к заказу по правам | **F** | isCourierAssignedToOrder, неназначенный → 403 (тест) |
| Pickup | **F** | PATCH deliveries action=pickup (9 кейсов контракта) |
| Передача покупателю | **F** | PATCH orders DELIVERED → CAS + sync deliveries + courier_earnings снимком (12 кейсов) |
| Неудачная доставка | **A** | статус `failed` в схеме, ни один роут не пишет |
| История доставок | **E** | из deliveries |
| Заработок | **F учёт / A выплаты** | deliveries.courier_earnings — канонический источник (тесты); **payout-контур CONFECTIONER-only** |
| Гео-трекинг | **D** | API + socket готовы; клиент не шлёт и не рисует |
| Уведомления о новых заказах | **A** | шаблона нет |

### 3.7 DECOR SHOP

Отдельной роли **нет**; магазины — builder_decor_shops (0014, ADMIN-only запись), товары — decor_products (0040, без RLS/owner_id).

| Функция | Статус |
|---|---|
| Профиль/каталог | **C** (витрина dual-mode живая; self-service A) |
| Продажа и аренда | **A** (is_rent нет; «аренда» только в моках) |
| Варианты/комплектации | **A** |
| Остатки | **C** (boolean in_stock, без количества и декремента) |
| Календарь аренды | **A** (availability-calendar.tsx — orphan) |
| Доставка/самовывоз | **C** (pickup-point API — TODO-заглушки) |
| **Заказ декора** | **B с блокирующим дефектом**: «в корзину» кладёт pseudo-item → **/api/cart и /api/checkout падают** (валидация только products → «Product not found», 500) |
| Согласование/связь | **A** |
| Финансы/отзывы | **A** (рейтинг 4.5 захардкожен) |

### 3.8 ANIMATOR

Роль ANIMATOR_AGENCY; витрина /services-shop живая (service_products 0029 с RLS).

| Функция | Статус |
|---|---|
| Профиль/портфолио | **C** (только profiles; отзывов/портфолио услуг нет) |
| Каталог программ | **E** (ServicesManager CRUD полный: возраст/длительность/цены) |
| География | **C** (city/format фильтр) |
| Календарь доступности | **A** (слотов нет, конфликтов дат нет) |
| Бронирование | **C** — POST /api/services/bookings существует (снапшот цены, n8n), **UI не вызывает**; **PATCH нет** → провайдер не может подтвердить/отклонить |
| Согласование/общение | **A** |
| Оплата брони | **A** (не создаёт order/payment) |
| Статусы/история/отзывы | **C/A** (enum в БД; is_verified/rating — мёртвые поля) |

Площадки (VENUE_OWNER) — самая зрелая часть услуг: venues + bookings с PATCH-переходами (**E**, без тестов).

### 3.9 ADMIN

| Функция | Статус | Комментарий |
|---|---|---|
| Пользователи/блокировки | **E** | admin/users (защита SUPER_ADMIN, self-block запрет); **выдачи/снятия ролей нет** |
| Модерация продавцов | **C** | кондитеры approve/reject + очередь /api/moderator/* (в dev отдаёт 6 mock-items **без NODE_ENV-гейта**); прочие роли не модерятся |
| Модерация каталога | **E** | products blocked + медиа-очередь |
| Категории | **A** | CRUD нет |
| **Управление заказами** | **C реал / B фейк-UI** | реальный скоуп: PATCH orders + ops/orders-today (риск-движок); **AdminOrdersManager работает на Zustand без единого API** — тосты без записи в БД |
| Платежи/возвраты | **E/F** | webhook (F), refund-исполнение (RPC reserve_refund), admin/payouts CAS; financial_ledger (0063) **без UI чтения** |
| Комиссии | **A** | только снапшот тарифа при заказе |
| Промокоды | **A (CRUD)** | применяются, создать через продукт нельзя |
| Споры | **A** | домена disputes нет; только support_tickets |
| Поставщики | **A** | — |
| Доставки | **C** | через orders PATCH; отдельного UI нет |
| CMS | **E** | cms/* полно; тестов нет |
| Настройки | **C** | site_settings, promo-popup |
| Журнал действий | **C** | audit_log пишется (44+ вставок) — **чтения нет**, вкладка «audit» — placeholder |
| Аналитика платформы | **E** | admin/dashboard (тест 401/403), ops/summary |
| Антифрод | **E/F** | anti-fraud + fraud-monitor (тесты) |
| Обращения | **E/F** | crm/tickets (изоляция залочена тестами) |

### 3.10 SUPPORT

| Функция | Статус | Комментарий |
|---|---|---|
| Очередь обращений (тикеты) | **C** | crm/tickets; **у SUPPORT-роли тикетного UI нет** (AdminTicketsTab только в админ-дашборде) |
| Категории/приоритеты | **C** | enum; валидации категории нет |
| Привязка к заказу | **C** | order_id пишется, существование не проверяется |
| История общения | **E** | messages embed; internal скрыты |
| Назначение | **E** | PATCH assignedTo + operator/assign (CAS) |
| Статусы | **E** | PATCH; матрицы переходов нет |
| Внутренние заметки | **F** | is_internal на сервере + RLS (тест) |
| Эскалация чата | **A→F (исправлено Z-v16)** | была полностью сломана (см. §7); теперь: явный запрос оператора → chat_escalations → очередь оператора → тред → ответ → уведомление |
| SLA/сроки ответа | **A** | first_response_at — мёртвая колонка |
| Аналитика нагрузки | **A** | — |

**Исправлено в Z-v16:** контур эскалаций не работал end-to-end и молча: (1) auto-reply вставлял в operator_escalations с NOT NULL ticket_id/operator_id → 23502 → catch → «передал оператору» без записи; (2) operator/escalations|assign|resolve читали chat_escalations, а operator/messages — operator_escalations → 404 всегда; (3) легаси-regex `\b` не матчил кириллицу. Теперь единая точка lib/chat-escalations.ts (см. §13).

## 5. Дублирующиеся механизмы (техдолг)

1. **Две матрицы переходов статусов**: lib/ops/lifecycle.ts ORDER_TRANSITIONS (полная) vs orders/[id]/route.ts STATUS_TRANSITIONS (усечённая) — два источника истины.
2. **Корзина**: Zustand-persist (UI-источник) + cart_items (зеркало) + cart-sync/merge — задокументированный dual-mode; офлайн-удаление может «воскреснуть» (нет tombstones).
3. **Чат-хранилища**: chat_channels (каноничное) vs chat_rooms (0017 легаси); auto-reply и operator/messages частично на легаси.
4. **Отзывы**: product_reviews (канон) vs reviews, video_reviews (легаси).
5. **Аудиты ×4**: audit_log (0018), financial_audit_log (0010), financial_audit_logs+audit_logs+action_logs (0017, camelCase-дубли).
6. **Quote-системы ×2**: inquiries/negotiations (0004, используется) vs quote_requests/confectioner_quotes (0023, не подключена).
7. **Бронирования ×4**: service_bookings, venue_bookings, декор-в-корзине (ломается), orders (products/custom) — нет полиморфной модели предложения.
8. **Уведомления-prefs ×2**: notification_preferences (0001) vs profiles.notify_prefs (0042/0059).
9. **RBAC**: permissions/role_permissions (0011) фактически параллельны user_roles-проверкам.
10. **Токены сессии**: app-JWT и GoTrue-cookie принимаются оба тракта.

## 6. Сквозные сценарии (проверка §6 задания)

### Сценарий 1. Покупка торта — **работает (E/F) с дырами**
Покупатель → каталог → кондитер → карточка → корзина → checkout (доступность, промо, идемпотентность) → оплата YooKassa → эскроу → accept кондитером (гейт дефицита) → производство (чеклист) → READY → курьер → DELIVERED → отзыв. Уведомления на каждом шаге. **Обрывы:** индивидуальный заказ — покупатель не видит ответов на quote; мульти-продавец в одном заказе не моделируется (confectioner_id первого товара); заказ декора/услуги из корзины — 500.

### Сценарий 2. Производство — **C**
Заказ → accept-гейт проверяет потребность в ингредиентах (реально блокирует) → производство (checklist 0054) → ready-гейт с фото → handoff. **Обрыв:** рецепт нельзя создать (нет CRUD техкарт), списание — ручной батч (идемпотентный), связи order↔recipe нет → себестоимость и автосписание не замкнуты.

### Сценарий 3. Закупка — **A/B (разорван)**
Кондитер видит дефицит → авто-draft закупки есть. Дальше тупик: поиск поставщика — витрина-мок; запрос цены — inquiries закрыты для поставщиков; тендеры — POST /api/tenders пишет несуществующие колонки price_inquiries (падает); B2B-заказ (b2b/orders) — backend без UI, поставщик его не видит, транзакции нет. **Цепочка не проходит ни на одном шаге после черновика.**

### Сценарий 4. Доставка — **C/D (backend готов, фронт нет)**
READY → available-orders (API) → assign (атомарный клейм, API) → pickup → DELIVERED + earnings-снимок + sync. **Обрыв:** у курьера нет UI «биржи» — назначить себя невозможно из интерфейса; неудачная доставка не моделируется; уведомлений курьеру нет; выплаты курьеру нет.

### Сценарий 5. Мероприятие (торт+декор+аниматор) — **A (не существует)**
Единый заказ невозможен архитектурно: decor не заказывается (checkout падает), услуги бронируются вне orders, venue_bookings отдельная сущность без платежа. Полиморфная модель заказа не спроектирована. **Требует продуктового решения** — не имитировать агрегатор поверх 4 параллельных сущностей.

### Сценарий 6. Претензия — **C (после Z-v16)**
Покупатель → ProblemOrderDialog → support_tickets (реально) → поддержка: тикеты работают (изоляция тестами), эскалации чата — **исправлено и проверено в браузере Z-v16**. Возврат: заявка покупателя → admin исполнение → RPC reserve_refund → webhook refund.succeeded. **Обрывы:** SLA/first_response_at мертвы; домена споров/компенсаций нет; журнал действий админом не читается; SUPPORT-роль без тикетного UI.

## 7. Сопоставление с Qwen (`qwentopt` HEAD `7d5a789` — не менялся с контрольной точки; проверены исходники, не отчёты)

| Модуль Qwen | Факт по исходникам | Решение | Обоснование |
|---|---|---|---|
| AIAssistant | localStorage-стор, фейковый AI | **REJECT / ALREADY IMPLEMENTED (сильнее)** | В Conditera: серверный чат + ai-dialogue + FAQ-бот с эмбеддингами + (Z-v16) живые эскалации |
| VisualConstructorV2 | undo/redo past/present/future | **ALREADY IMPLEMENTED (адаптация Z-v15 `98c0ddc`)** | Паттерн перенесён в cake-builder через стор; localStorage-механика Qwen не переносилась |
| Analytics | `createdAt === dateStr`, константы +12%/+8%, demo-стор | **REJECT / ALREADY IMPLEMENTED** | analytics-compute на реальных заказах + ops-движки; дефекты Qwen подтверждены в исходниках |
| Recommendations | rule-based на demo-сторе | **ALREADY IMPLEMENTED** | /api/recommendations читает product_favorites (после починки split-brain избранного станет полнее) |
| AICakeGenerator | Math.random + setTimeout | **REJECT** | Фикция; в Conditera конструктор реальный с серверной ценой |
| EventPlannerPro | demo-события, локальный state | **REJECT (код) / NEEDS PRODUCT DECISION (идея)** | Единый заказ мероприятия требует полиморфной модели заказа — продуктовое решение владельца |
| B2BMarketplace V2 | hardcoded demo-поставщики/товары | **REJECT (данные) / ACCEPT (UX-идеи в backlog)** | Фильтры/сравнение/калькулятор как UX-референс для реального B2B-контура (P1/P2) |
| store.ts | localStorage-стор как источник истины | **REJECT** | В Conditera серверное зеркало корзины/заказов; localStorage — только UI-кэш |

**Вывод:** ни один модуль Qwen не даёт production-бизнес-логики; Conditera по всем семи направлениям либо уже сильнее, либо имеет честный backlog. Единственная проверенная ценность (undo/redo-паттерн) интегрирована в Z-v15.

## 8. Фиктивные механизмы в production-путях (карта фикций)

1. `/api/confectioner/predictions` — при ошибке БД подставляет generateMockOrders() (Math.random-история 45 заказов) **без NODE_ENV-гейта**.
2. `/api/moderator/queue` — 6 статических mock-items при пустой очереди, без гейта.
3. `/api/products/[id]/slices` и `slice-3d-config` — mock/Math.random фолбэки.
4. `AdminOrdersManager` — мок-мутации без БД (вводит админа в заблуждение).
5. customer-dashboard:666 — блок «Рекомендуем вам» из MOCK_PRODUCTS безусловно.
6. n8n-automation-dashboard — случайные метрики Math.random.
7. /reviews, /supplier-shop, TendersPage — статические моки при живых/сломанных API.
8. /api/pickup-point/*, /api/cron/status (нет проверки JWT) — TODO-заглушки.
9. tfa-settings:50 — «заглушка: тянем с /api/auth/me».
10. Курьер-дашборд: «Активен»/«Автомобиль» — константы; «В обработке» выплат — formatCurrency(0).

## 9. Дыры безопасности/целостности

1. **[ЗАКРЫТО Z-v16]** GET /api/crm/leads отдавал CONFECTIONER все лиды платформы.
2. Таблицы без RLS/GRANT: `order_tracking`, `courier_locations`, `courier_profiles` — через /rest/v1 шим authenticated может читать GPS-треки.
3. organization/cron-recheck — блокировка ликвидированных организаций закомментирована (fail-open в кроне при fail-closed в гейтах).
4. PATCH /api/crm/tickets/[id] — не валидирует enum статуса/приоритета и существование assignee.
5. `/api/cron/status` — не проверяет админ-JWT (TODO в коде).
6. Мок-фолбэки без NODE_ENV-гейта (§8.1–8.2) — выдача фиктивных данных как реальных.

## 10–12. Backlog P0–P3, зависимости, последовательность

### P0 — блокирует основные операции
| ID | Задача | Зависимости | Статус |
|---|---|---|---|
| P0-1 | Починка контура эскалаций поддержки (единая точка chat_escalations, триггер в messages, operator/messages на каноничной таблице, дедуп open-статусов) | — | ✅ **СДЕЛАНО Z-v16** |
| P0-2 | Закрыть утечку CRM-лидов (CONFECTIONER → staff-only) | — | ✅ **СДЕЛАНО Z-v16** |
| P0-3 | Заказ декора/услуги ломает checkout (500): либо проводка через orders, либо вывод из корзины в booking-флоу | **продуктовое решение** по модели предложений | открыт |
| P0-4 | supplier_profiles onboarding (создание профиля при регистрации/первом входе) + убрать админ-табы из кабинета поставщика | — | открыт |
| P0-5 | AdminOrdersManager → серверный источник (ops/orders-today + PATCH) | — | открыт |
| P0-6 | RLS/REVOKE на order_tracking, courier_locations, courier_profiles | миграция | открыт |
| P0-7 | Ответы на quotes видны покупателю (GET ?mode=my в UI) | — | открыт |
| P0-8 | PATCH /api/services/bookings (confirm/reject/cancel) + брони в кабинете аниматора | — | открыт |

### P1 — обязательная база роли
| ID | Задача | Зависимости |
|---|---|---|
| P1-1 | Курьерская «биржа»: UI available-orders + assign (API готов) | P0-6 желательно |
| P1-2 | Выплаты курьерам (расширить payout-контур) + активация курьеров админом | паттерн P0-4 |
| P1-3 | CRUD техкарт (рецепты + recipe_ingredients) → себестоимость и осмысленное списание | связка с write-off 0049 |
| P1-4 | Конфигурация capacity кондитером (API+UI confectioner_capacity) | — |
| P1-5 | Split-brain избранного: сердечки → /api/wishlist | — |
| P1-6 | Admin: CRUD категорий + промокодов; чтение audit_log; чтение financial_ledger | — |
| P1-7 | Свести матрицы переходов статусов (lifecycle.ts как единственный источник) | аккуратно, с тестами |
| P1-8 | Тесты на слепые зоны: courier assign/available-orders, wishlist, repeat, refund, operator/*, admin/users, moderation | — |
| P1-9 | Team API: починка camelCase/split + accept-invite (BUSINESS) | колонки 0017 есть |
| P1-10 | SUPPLIER: оптовые цены write-API + заявки поставщикам | P0-4 |

### P2 — расширения/конкурентные преимущества
Аналитика кондитера (маржа, когорты) · рекомендации с серверным избранным · SLA поддержки (first_response_at) · аренда декора (календарь занятости) · серверная пагинация каталога + Meilisearch · полиморфная модель предложений (после продуктового решения) · тикетный inbox для SUPPORT-роли · чат-модерация в UI кондитера · гео-трекинг клиента курьера · очистка легаси-таблиц (chat_rooms, reviews×2, аудиты×4, quotes 0023) · NODE_ENV-гейты для мок-фолбэков.

### P3 — косметика/второстепенное
Дашборды BLOGGER/TASTER/NUTRITIONIST из констант · pickup-point контур · франшиза · live-streams · геймификация.

**Предлагаемая последовательность:** Z-v17 = P0-3 (после решения владельца) + P0-4 + P0-5 + P0-6 + P0-7 → Z-v18 = P1-1 + P1-2 (замкнуть доставку) + P1-8 → Z-v19 = P1-3 + P1-4 (замкнуть производство) → далее P1-5..P1-10.

## 13. Выполненные изменения Z-v16 (P0-блок)

| Файл | Изменение |
|---|---|
| `src/lib/chat-escalations.ts` | **НОВЫЙ** — единая точка создания эскалаций: колонки 0019, дедуп по открытым статусам (pending/assigned), fail-safe, looksLikeOperatorRequest (кириллица работает, в отличие от легаси `\b`) |
| `src/app/api/chat/rooms/[id]/messages/route.ts` | Триггер: support-канал + не-staff/не-бот + запрос оператора → createChatEscalation (после сохранения сообщения, fail-safe) |
| `src/app/api/operator/messages/route.ts` | Переведён с operator_escalations на **chat_escalations**; user_name из profiles, message из metadata; сообщения по channel_id (0004) с легаси-fallback; авто-назначение 0019-колонками; метрики chat_channels |
| `src/app/api/crm/leads/route.ts` | CONFECTIONER удалён из GET (staff-only) — утечка закрыта |
| `src/lib/chat-escalations.test.ts` | **НОВЫЙ** — 14 тестов (детект кириллицы/латиницы, дедуп pending+assigned, колонки, fail-safe, обрезка превью) |
| `src/app/api/chat/rooms/[id]/messages/route.escalation.test.ts` | **НОВЫЙ** — 6 герметичных тестов (триггер/дедуп/не-support/staff/fail-safe) |
| `src/app/api/operator/messages/route.test.ts` | **НОВЫЙ** — 7 тестов контракта (маппинг, 404/403/422, авто-назначение, channel_id, уведомление) |
| `src/app/api/crm/leads/route.test.ts` | **НОВЫЙ** — 6 тестов изоляции (403 кондитеру, staff 200/201, фильтр) |
| `scripts/z16-check-escalations.mjs`, `scripts/z16-list-staff.mjs` | Read-only проверочные скрипты E2E |

## 14. Результаты тестирования

| Проверка | Результат |
|---|---|
| `bun run test` (vitest, полный) | **90 файлов, 1390/1390 PASS** (до Z-v16: 1325/1329 + 4 redline-fail; redline теперь 9/9) |
| Новые тесты Z-v16 | 32/32 PASS (4 файла) |
| `bun run lint` | 0 ошибок |
| `bun run typecheck` | 0 ошибок |
| redline-paths.test.ts | 9/9 PASS (защищённые файлы на диске) |
| Browser E2E (покупатель) | регистрация → support-чат → «Оператор, помогите…» → **эскалация в БД** (manual_request/high/pending, preview совпадает) |
| API E2E (оператор, support@demo.ru) | GET escalations → 1 pending; GET thread → маппинг + история; POST reply → 200, autoAssigned=true; POST resolve → 200; очередь pending → 0 |
| DB E2E | статус → assigned; сообщение оператора в chat_messages.channel_id; **уведомление покупателя** (колокол: «Оператор поддержки написал вам» + deep-link); ответ виден в чате после F5 |
| Дедуп вживую | повторный запрос при открытой эскалации не создаёт дубль (3 запроса → 2 записи, третья заблокирована открытыми) |
| Негативные | fail-safe: недоступность chat_escalations не роняет отправку (тест + живой warn в логе); не-staff 403; чужой escalationId 404; text>5000 → 422 |

## 15. Git checkpoint

- Ветка `main`; HEAD до Z-v16: `7eaade1`; после реализации — локальный коммит (SHA в отчёте Z-v16).
- Push/merge/deploy не выполнялись. Защищённые upload-файлы: 4/4 на диске, состояние не менялось. skip-worktree/hooks не трогались. `.env.local` не изменялся, секреты не выводились.
- Миграций в Z-v16 нет — использована существующая `chat_escalations` (0019). Пользовательские данные не удалялись; тестовые записи E2E помечены естественным образом (e2e-аккаунт z16-cust-e2e@test.local) — очистка по решению владельца.
