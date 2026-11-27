# CONDITERA INTEGRATION MAP (Cake Studio V2)

**Статусы:** REUSE — используем без существенной переработки · ADAPT — сохраняем, но адаптируем · REPLACE — заменяем реализацию · NEW — создаём новый модуль · VERIFY — недостаточно доказательств · BLOCKED — невозможно проверить в текущем окружении.

**Примечание к именованию:** в задании файл назван `COND­ITERA_INTEGRATION_MAP.md` (содержит невидимый символ U+00AD «мягкий перенос»); файл нормализован в ASCII: `CONDITERA_INTEGRATION_MAP.md`.

**Cake Studio V2 (архив `conditera_cake_studio_v2.zip`): НЕ НАЙДЕН в окружении** — все зависящие от V2 пункты помечены VERIFY/BLOCKED (см. GROUND_TRUTH §3.3). Формат Cake Project, Windows-зависимости и переносимые модули V2 будут определены после передачи архива.

---

## 1. Конструктор тортов

| Функция | Фактический файл/API/таблица | Текущее состояние | Решение | Риски | Проверка |
|---|---|---|---|---|---|
| Точка входа (route) | `src/app/cake-builder/page.tsx` → RouteFallback → `CakeBuilderPage` (`route-fallback.tsx:48,190`); SPA-вью: `app/page.tsx:216-217` | LIVE, в sitemap | **REUSE** | — | Проверено импортами |
| Заголовочные CTA | `header.tsx:275,391,530`; `footer.tsx:16`; `command-palette.tsx:85-91` | LIVE | **REUSE** | — | — |
| `CakeBuilderDialog` | `cake-builder-dialog.tsx:57`; смонтирован `app/page.tsx:290`, `dashboard/page.tsx:213,227`, `route-fallback.tsx:222`; открыт из home hero `home-page.tsx:279,723` | LIVE-монтаж, **submit mock-only** (только zustand) | **REPLACE** (унификация на страницу) | Пользователь думает, что отправил заявку, а данные никуда не ушли | Прогон hero-CTA: сеть отсутствует |
| `CakeVisualPreview` + `cake-visual-map.ts` | `cake-visual-preview.tsx:212`; mapper `cake-visual-map.ts:134-169` (+тест) | DEAD (0 импортёров), конфиг-драйвен, палитра по mock-id | **ADAPT + WIRE** (подключить как живое превью) | Палитра не знает про DB-начинки (`color_code`) | тест cake-visual-map.test.ts |
| Состояние builder | Zustand `useAppStore` (`store.ts:562-563,589`); поля `types.ts:1313-1342`; undo/redo `use-cake-builder-history.ts:19-58` | LIVE; persist исключает cakeBuilder (`store.ts:2266-2280`) → черновик в памяти | **REUSE**; draft-persistence → NEW (B-10) | Перезагрузка = потеря конфигурации | cake-builder-history.test.ts |
| Supabase hooks builder | `supabase/use-cake-builder.ts` (drafts/options/negotiations) | DEAD (только тест-импорт); accept-путь заблокирован триггером 0085 | **REPLACE** (переписать на API-client) | Ловушка `cake_builder_options.price_modifier` в копейках | supabase-hooks.test.ts |
| Опции конструктора | mock `CAKE_BUILDER_OPTIONS` (`mock-data.ts:1812-2222`) — productTypes/bases/coatings/decorations/dietary/shapes/tiers | Hardcoded, используется и сервером | **ADAPT → DB** (`builder_config` 0014 уже есть, не подключён) | Расхождение клиент/сервер при правке цен | `cake-builder-options.test.ts` |
| Начинки | DB `fillings` (0010/0020/0043) через `GET /api/fillings/list`; сервер: `builder-fillings-server.ts:11-22` fail-closed + `mergeBuilderFillings` (`cake-builder-pricing.ts:94-104`) | LIVE, гибрид DB+mock | **REUSE** (контракт fail-closed) | Seed пишет несуществующие колонки (V-3) | builder-fillings-server.test.ts |
| Кондитеры (шаг 8) | store mock `MOCK_CONFECTIONERS` (`store.ts:605`), hydrate через `GET /api/confectioners` (`confectioners-marquee.tsx:167-184`) | Гибрид; VERIFY V-11 (марки не на всех поверхностях) | **ADAPT** (гарантировать hydrate до шага 8) | Выбор по mock-кондитерам → заявка в никуда | runtime-прогон |
| Шаг 2.5 tiers/shape | `cake-builder-page.tsx:767-859`; `step:2.5` никем не ставится | **Недостижим**; из цены исключён (`cake-builder-pricing.ts:15-16`) | **ADAPT** (восстановить переход или удалить) | tiers/shape не ценообразуются | grep `step: 2.5` — 0 |
| Submit заявки (основной) | `use-inquiry-submit.ts:84-117` → `POST /api/inquiries` (`route.ts:168-252`) | LIVE: draft→inquiry→N negotiations (≤5), 48h, notify | **ADAPT** (см. DATA_MODEL §4.2: не терять productType/tiers/shape/quantity/address) | Потеря полей; документ обещает PATCH/DELETE, которых нет (`route.ts:11-12`) | api-тесты; ручной флоу |
| Переговоры | `PATCH /api/negotiations/[id]` (quote/accept/decline/counter; `negotiation_revisions` снапшоты, 409/410, `valid_until` 14d + триггер 0085) | LIVE, сплошной CAS | **REUSE** | — | negotiation-binding.test.ts |
| Accept → checkout | `use-buyer-offers.ts:306-336` → `goToCheckout` (`buyer-offers-tab.tsx:231-267`) → `buildInquiryBuilderConfig` (`offer-format.ts:159-180`, **hardcode `productType:"cake"`**) → `POST /api/checkout` (`route.ts:474-508,751-763`) | LIVE, один заказ на оффер | **ADAPT** (убрать hardcode через Cake Project) | Нееёк-торты ценятся как торты | U-05 evidence |
| Legacy quotes | `POST /api/quotes` + `quote_requests`/`confectioner_quotes` (0023:145-268) | LEGACY fallback; нет accept-эндпоинта; units bug рубли/копейки (`cake-builder-page.tsx:312` vs 0023:180) | **REPLACE/RETIRE** | Двойной контур заявок | grep вызовов |
| Pricing (формула) | `cake-builder-pricing.ts` (isomorphic; серверная авторитетность на checkout; региональный множитель `regional-pricing.ts:61,167-172`) | LIVE | **REUSE** | — | cake-builder-pricing.test.ts |
| Назначение кондитера на кастом-заказ | `checkout/confectioner-assignment.ts` (`resolveCustomConfectioner`) | **DEAD** (только тест) → заказы уходят с `confectioner_id=null` | **ADAPT + WIRE** (B-13) | Заказ без кондитера не берётся в работу | тест + grep импортов |
| Корзина custom | `cart_items.custom_config` + `client_ref` (0062:22-41); `cart-sync.ts` | LIVE, ownership-safe | **REUSE** | — | cart 48/48 тестов |
| `builder_config`/`builder_partner_offers`/`builder_decor_shops` (0014) + API | `api/builder/config`, `/partners`, `/decor-shops` | Таблицы+API есть; UI не подключён (decor-shops — только витрина decor-shop) | **ADAPT** (подключить как источник опций) | — | grep потребителей |

## 2. Рецептуры и разрез

| Функция | Фактический файл/API/таблица | Текущее состояние | Решение | Риски | Проверка |
|---|---|---|---|---|---|
| Корень рецептов | `recipes` (0010:106-138; +0065 content; +0076 moderation), `author_id → auth.users` | LIVE, статус-машина draft→published | **REUSE** | 0077: REVOKE клиентских записей — пишет только service_role | миграции |
| Шаги/ингредиенты/варианты | `recipe_steps`, `recipe_ingredients` (0067), `recipe_variants`, `recipe_ingredient_substitutes`, `recipe_sources` (0066) | LIVE (нормализованные) | **REUSE** | `recipe_ingredients` RLS `USING(true)` (0053:150-153; 0073 не существует) — over-read | RLS spot-check |
| Публикация/версии | `recipe_versions` (0066:419-431; snapshot JSONB; без клиентских политик); `update_recipe_with_ingredients` RPC (0081:519-653) | LIVE, иммутабельные | **REUSE** (паттерн для Cake Project) | — | миграции |
| Коммерция рецептов | `recipe_marketplace` (0012+0068, FK→recipes RESTRICT), `recipe_purchases` (0072/0075, entitlement) | LIVE | **REUSE** | `types.generated.ts` устарел (нет колонок 0065/0076/0043) | entitlement.test |
| Доступ (paywall) | `recipes/access-resolver.ts:81-167` + `gateRecipeContent` + `entitlement.ts` | LIVE, серверная проверка платежей | **REUSE** | — | тесты рецептов |
| Производство | `recipe_production_cards/_ingredients/_versions/_batches` + `recipe_card_cost_history` (0070/0071), pin recipe_version_id | LIVE, owner-скоупед | **REUSE**; батчи↔заказы — вручную | Автоматической привязки card↔order нет | production.ts |
| Начинки (каталог builder) | `fillings` (0010/0020/0043: slice_image, slice_config) | LIVE, модерация APPROVED | **REUSE** | seed-колонки (V-3) | fillings-data.test.ts |
| Slice-визуализатор | `cake-slice-visualizer.tsx` (SliceSVG:127-290, PRESETS:43-113, detectPreset:116-124, ProductSliceGallery:786, FillingSlicePreview:1073) | LIVE; **SVG из шаблона по имени** — НЕ из рецептуры | **ADAPT** (источник = `fillings.slice_config`/рецептура; detectPreset оставить фоллбэком) | Иллюзия «разрез по рецепту» | U-06 evidence |
| Фото-разрезы витрины | `product_slices` (0017:281-293, camelCase) + `GET /api/products/[id]/slices` | LIVE; реальное фото = путь A | **REUSE**; API DELETE без ownership-ре-проверки (`slices/route.ts:178-213`) — ADAPT | RLS отсутствует (V-4) | миграции/grep |
| 3D-разрез | `GET /api/products/[id]/slice-3d-config` (`route.ts:161-186,432-455`) | LIVE; product_slices.config → шаблон по имени | **ADAPT** (унаследует источник после фикса provenance) | — | — |
| AI-визуализация | `/api/fillings/ai-generate-slice` (LLM SliceConfig), `ai-photo-generator` → `/api/products/ai-photo` (stock-fallback Unsplash) | LIVE, класс C | **ADAPT** (писать provenance в recipe_media ai_generated) | AI-фото прикладывается к products.images, не к recipe_media | route код |
| Снапшот рецепта на заказ | `orders.metadata.acceptance_snapshot` (`ops/snapshot.ts`; checkout:633-657; /api/orders:488-502) — fail-closed, MVCC 1 стейтмент | LIVE; `recipe_version_id` всегда null (резерв) | **REUSE** (+решение о заполнении version_id) | — | snapshot.test.ts |
| Списание | `apply_order_write_off_atomic` (0081:123-180+), валидация против снапшота | LIVE | **REUSE** | — | verify-скрипты |

## 3. Чат

| Функция | Фактический файл/API/таблица | Текущее состояние | Решение | Риски | Проверка |
|---|---|---|---|---|---|
| Виджет | `chat-widget.tsx` (Sheet, гостевой r3, polling 5/15 с, optimistic+idempotency) | LIVE | **ADAPT** (ветка рендера cake_design) | Дедуп по text+sender 15 с | verify-chat-runtime.mjs |
| API комнат/сообщений | `/api/chat/rooms[/...]` (`chat-rooms.ts`; supabaseAdmin → RLS bypassed; доступ в коде `canAccessRoom:106-114`) | LIVE | **REUSE** | RLS существует на бумаге (0004:411-491), но не работает | код-ревью |
| Realtime | socket.io `mini-services/chat-server/index.ts` (порт 3030; JWT; membership gate fail-closed 60 c кеш; re-POST с JWT отправителя) + `use-socket-io.ts` | LIVE (реалтайм), polling fallback | **ADAPT** (расширить белый список полей:721-734) | Неизвестные поля payload обрезаются | verify-chat-runtime |
| Supabase Realtime | `supabase/use-chat.ts`, каналы в use-cake-builder/use-crm | **DEAD** (нет /realtime/v1; 0 импортёров) | **REPLACE/DELETE** | — | grep |
| Модель сообщения | `chat_messages` (0004:225-245; +0040): text, attachments JSONB (пустой), metadata JSONB, is_bot/bot_kind, idempotency_key; **message_type нет** | LIVE | **ADAPT** (B-16: metadata-payload или +колонка) | MAX_TEXT=4000; FAQ-бот может среагировать на текст карточки | миграции |
| Вложения/голос | `/api/upload` → бакет media (удалён drift'ом, в HEAD); голос — blob-демо, mic заблокирован Permissions-Policy | Вложения НЕ реализованы | **NEW** (пайплайн) / **RESTORE** роута | messages-бакет (0026) нигде не используется; audio MIME не разрешён | git show HEAD:... |
| Чат заказа | `chat_channels.order_id` + partial UNIQUE (0058); `ensureOrderChatChannel` (`chat-rooms.ts:255-355`); бридж `chat-order-bridge.ts` | LIVE, один чат на заказ | **REUSE** | 403 для неучастников | U-03 evidence |
| Чат переговоров | `chat_channels.negotiation_id` FK (0004:187) | **FK есть, код-пути нет**; UI переговоров = MOCK_NEGOTIATIONS | **NEW** (решение: отдельная карточка в чате заказа или привязка) | Легаси `negotiation_messages` без UI | grep |
| Боты/эскалации | socket FAQ-бот (`chat-server:368-534`), `chat-automation.ts` (webhook/cron), `chat-escalations.ts` → операторская | LIVE | **REUSE** | Ложные срабатывания на карточки дизайна | verify-скрипт |
| Dormant-чат | `/api/chat/auto-reply`, `/bot-trigger`, `chat-faq-embeddings`, legacy `chat_rooms` | Без вызовов | **REPLACE** (демо-broken) | operator_escalations INSERT документированно падает | grep |
| AI-ассистент | `ai-assistant-widget` + `/api/ai-assistant/chat` (свои таблицы) | Отдельная инфраструктура | **KEEP SEPARATE** | — | route код |

## 4. Заказы

| Функция | Фактический файл/API/таблица | Текущее состояние | Решение | Риски | Проверка |
|---|---|---|---|---|---|
| Модель заказа | `orders` (0002:179-214; +0034 деньги; +0040 поля; metadata jsonb), enum order_status (0001:72-76, 10 значений) | LIVE | **REUSE** | Двойной формат номера ORD-/UK-; payment_status 'failed' запись (V-7) | миграции |
| order_items | 0002 (product_title/unit_price) + 0040 (title/price/customization) — **двойной набор**; `selected_attributes`=конфиг builder; +0084 price_version_id | LIVE | **REUSE**; дрейф колонок задокументировать | GET /api/orders мерджит оба набора (orders/route.ts:144-165) | миграции |
| Lifecycle | Движок `ops/lifecycle.ts:66-195` (CAS, QC ready-gate, события) + legacy PATCH-матрица (`orders/[id]/route.ts:31-40`) | LIVE (движок superset) | **REUSE** движок; **ADAPT** — консолидировать матрицы (B-22) | Две матрицы расходятся | order-lifecycle-verify |
| Capacity/производство | `confectioner_capacity`, `capacity_reservations` (EXCLUDE), `order_production`, чек-листы (0054) | LIVE | **REUSE** | — | verify |
| order_media | 0054:189-205; kind free text; ФС `orders/<id>/published/photos/`; ≤5 фото; upload только кондитер/admin; байты — party/staff | LIVE | **REUSE** + **NEW kind `approved_design`** (B-15) | RLS: metadata видна всем authenticated (0054:213-218) | миграции |
| Payments/escrow | webhook (`payment/webhook/route.ts:276-336`) → escrow CAS; cron 24h `release_escrow_order` (0037); legacy `escrow_accounts`+триггер 0011 (7d) | LIVE путь = orders.payment_status | **REUSE** живой путь; **REPLACE** escrow_accounts (B-23) | Edge Function yookassa-webhook — расходящаяся заглушка (V-5) | verify-money-path |
| Checkout | `POST /api/checkout` — Idempotency-Key, 15 мин replay, fail-closed fillings, negotiation binding | LIVE | **REUSE** | — | checkout-idempotency.test |
| Аудит | `audit_log` (0018) + `domain_events` (0053, dedup) + `order_status_history` (0061: app-only) + timeline merge | LIVE | **REUSE** (не добавлять четвёртый слой) | — | — |
| Ops-центр | `admin-ops-center.tsx`, ops_tasks (0053), rules/visibility | LIVE | **REUSE** | — | — |
| n8n авто-подтверждение | `13-order-processing.json` ждёт `autoApproveEligible` | Параметр **не реализован** в GET /api/orders | **VERIFY** → NEW-решение (B-24) | Мёртвая автоматизация | grep |
| UI-статусы | `types.ts:1123-1136` содержит IN_PROGRESS/DELIVERING/DISPUTE (нет в enum) | Дрейф типов | **REPLACE** на DB-производные (B-25) | DISPUTE-карточки невозможны | адаптеры use-real-orders |
| Mock-фоллбэк заказов | `use-real-orders.ts:129-158` fallback → MOCK_ORDERS с isStale | LIVE | **ADAPT** (изолировать фоллбэк) | Пользователь видит mock как «заказы» | код |

## 5. Cake Studio V2 (архив)

| Функция | Фактический файл/API/таблица | Текущее состояние | Решение | Риски | Проверка |
|---|---|---|---|---|---|
| Исходники V2 | `conditera_cake_studio_v2.zip` | **НЕ НАЙДЕН** в окружении | **BLOCKED** — запросить архив у владельца; после передачи: инвентаризация модулей, Windows-зависимости (реестр/пути/файловый формат), маппинг на cake_projects | Модули могут зависеть от Win-специфики (см. V-2) | повторный аудит §6 задачи |
| Формат Cake Project | неизвестен | unknown | **VERIFY** | Конвертер в `config` (schema_version) проектируется после получения | — |
| Переиспользуемые модули V2 | неизвестны | unknown | **VERIFY** | Не переносить код автоматически (условие задачи) | — |

## 6. Инфраструктура/общее

| Функция | Фактический файл/API/таблица | Текущее состояние | Решение | Риски | Проверка |
|---|---|---|---|---|---|
| Supabase-транспорт | same-origin shim: `/rest/v1/[...path]` (postgrest/*), `/auth/v1`, `/storage/v1` → `./upload/storage`; **нет /realtime/v1** | LIVE | **REUSE** | Прод-деплой с реальным Supabase изменит поведение RLS/Realtime — VERIFY перед запуском | url.ts:39 |
| Upload | `/api/upload` + `/api/services/upload` (ЗАЩИЩЁННЫЕ пути, drift-удалены из worktree, блобы в HEAD) | RESTORE затем **REUSE** | `scripts/protected-paths.sh repair` по решению владельца | Без них чат-вложения/студия не смогут заливать файлы | git show HEAD |
| uploads-реестр (0015) | таблица `uploads` | Не пишется upload-service | **ADAPT** (B-6) | Реестр-сирота | grep |
| Хранилище бакетов | 0026: avatars/covers/portfolio/product_images public; documents/messages private; 0121: **order_media** private (JPEG/PNG/WebP) | order_media используется для оригинальных фото готового заказа; выдача только через авторизованный API/signed URL | **REUSE** | Публичный доступ к фото заказа запрещён | миграции 0026, 0121 |

**Сводка решений:** REUSE — 30 · ADAPT — 17 · REPLACE — 7 · NEW — 5 · VERIFY/BLOCKED — 6 (детальная нумерация в BACKLOG).
