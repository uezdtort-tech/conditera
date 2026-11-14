# INTEGRATION GAPS AND RISKS (Cake Studio V2 × Conditera)

**Дата:** 2026-11-14 · Режим аудита: READ-ONLY · Все ссылки на доказательства — в `CAKE_STUDIO_INTEGRATION_GROUND_TRUTH.md` и `CONDITERA_INTEGRATION_MAP.md`.

---

## 1. Пробелы, непроверяемые в текущем окружении (граничные условия аудита)

| ID | Пробел | Последствие для интеграции | Как закрыть |
|---|---|---|---|
| G-1 | **Архив Cake Studio V2 отсутствует** — поиск по `/home`, `/tmp` дал 0 совпадений (`conditera_cake_studio_v2.zip`), упоминаний «Cake Studio» в репозитории нет | Шаг 6 задачи BLOCKED: модули V2, Windows-зависимости, формат Cake Project, конвертер — не определены | Владелец передаёт архив; повторный read-only проход |
| G-2 | **Embedded PostgreSQL не инициализирован** (`.pgdata` отсутствует; `runtime.mjs status`: NOT INITIALIZED) | Применённость миграций (ledger) не подтверждена; реальные данные (fillings-колонки, seed-строки builder_config) не видны | `db:start` (создаёт кластер + применяет 85 миграций) — только по решению владельца, вне READ-ONLY |
| G-3 | **4 защищённых upload-маршрута удалены из рабочего дерева** (drift; блобы в HEAD; skip-worktree не установлен; pre-commit guard активен) | Чат-вложения, загрузка файлов студии, `/api/services/upload` не работают в текущем worktree | `scripts/protected-paths.sh repair` — только по решению владельца (в аудите не выполнялось) |
| G-4 | Нет CI-машины/AGENTS-раннера; RAM ~3.9 GiB | Полный прогон vitest/E2E и production build для проверки гипотез недоступен в этой сессии | Локальный прогон по чек-листу BACKLOG |
| G-5 | Внешние системы (YooKassa merchant-панель, n8n-инстанс, реальный Supabase в проде) не наблюдаются | V-5 (webhook URL), V-6 (n8n autoApprove), поведение RLS/Realtime при реальном Supabase | Проверка на staging по BACKLOG |

## 2. Риск-реестр

Шкала: severity — критический/высокий/средний/низкий; вероятность — высокая/средняя/низкая.

### 2.1 Целостность данных конструктора

| ID | Риск | Доказательство | Severity/Вер. | Митигация |
|---|---|---|---|---|
| R-1 | **Потеря полей конфигурации на заявке**: productType/tiers/shape/quantity/address не сохраняются в `cake_builder_drafts`/`inquiries`; на accept→checkout восстанавливаются с hardcode `productType:"cake"` | `0004:43-66,73-100`; `use-inquiry-submit.ts:29-42`; `offer-format.ts:162-176` | критический/высокая | Cake Project Core (DATA_MODEL §3-4), B-9/B-10/B-14 |
| R-2 | **CakeBuilderDialog создаёт ложное впечатление отправки**: submit кладёт данные только в zustand | `cake-builder-dialog.tsx:159-233` | высокий/высокая | Унификация входа на страницу (B-12) |
| R-3 | Шаг tiers/shape недостижим → неценообразуем | `cake-builder-page.tsx:767-859`; только `step+1` (:281,614,649) | средний/высокая | B-11 (или удалить мёртвый UI) |
| R-4 | Кастомные заказы уходят с `confectioner_id=null` (мёртвый `resolveCustomConfectioner`) | только тест-импорт; нет вызова из checkout/orders | высокий/средняя | B-13 |
| R-5 | Units bug legacy-quotes: клиент шлёт рубли в колонку «копейки» | `cake-builder-page.tsx:312` vs `0023:180` | средний/низкая (путь fallback) | B-8 (или ретируем контур) |

### 2.2 Деньги и заказы

| ID | Риск | Доказательство | Severity/Вер. | Митигация |
|---|---|---|---|---|
| R-6 | **Две модели escrow** (24h orders.payment_status + cron; 7d `escrow_accounts`+триггер 0011) и **две матрицы lifecycle** (PATCH-легаси vs ops/lifecycle.ts superset) | 0037:98-142 vs 0011:273-287; lifecycle.ts:66-195 vs orders/[id]/route.ts:31-40 | высокий/средняя | B-22/B-23 (консолидация, additive) |
| R-7 | Edge Function yookassa-webhook — расходящийся дубль (ставит status=CONFIRMED, не трогает payment_status) | `supabase/functions/yookassa-webhook/index.ts:93-98` | высокий/низкая (если webhook указывает на API route) | V-5 → выключить дубль |
| R-8 | `payment_status:'failed'` (вне enum) в POST /api/orders на бонус-фейле | `orders/route.ts:619` | средний/низкая | B-7 |
| R-9 | `orders_update_own` RLS позволяет покупателю UPDATE строки заказа через PostgREST | 0002:437-445 | высокий/низкая (фронт не пишет напрямую, но шим открыт) | Сузить политику (additive) до служебных колонок |
| R-10 | RLS `order_items` имеет только SELECT — записи идут только через service-role; любой прямой клиентский путь не покрыт | 0002:448-460 | средний/низкая | Документировать контракт «письмо только через API» |

### 2.3 Безопасность и приватность

| ID | Риск | Доказательство | Severity/Вер. | Митигация |
|---|---|---|---|---|
| R-11 | **`recipe_ingredients` RLS `USING(true)`** — любой authenticated читает все ингредиенты; сужение «назначено миграции 0073, которой нет» | 0053:150-153; 0065:93; файла 0073 нет (проверено) | высокий/высокая | B-3 (новая миграция сужения) |
| R-12 | `product_slices` без RLS; DELETE route без ownership-ре-проверки | 0017:281-293 (grep политик — 0); slices/route.ts:178-213 | средний/средняя | B-4 |
| R-13 | `supabaseAdmin` (service-role) импортирован в клиентский файл `use-escrow.ts` | use-escrow.ts:8,95,143,173,199 | высокий/низкая (точки монтирования не найдены) | B-5 |
| R-14 | Чат: RLS на бумаге, весь доступ через supabaseAdmin + код | chat-rooms.ts:106-114 | средний/средняя | Сознательный контракт; при переходе на реальный Supabase — ревизия |
| R-15 | `uploads`-реестр (0015) не заполняется → нет аудита загрузок | upload-service.ts:106-147 не пишет реестр | низкий/средняя | B-6 |

### 2.4 Визуализация разреза и данные рецептур

| ID | Риск | Доказательство | Severity/Вер. | Митигация |
|---|---|---|---|---|
| R-16 | **SVG-разрез — шаблон по подстроке названия**, не из рецептуры; иллюзия «разрез по рецепту» для покупателя | cake-slice-visualizer.tsx:116-124, 43-113 | средний/высокая | B-18 (provenance A/B/C-метки + slice_config источник) |
| R-17 | AI-изображения пишутся в products.images без provenance-метки в контуре рецептов | ai-photo/route.ts:98-103 | низкий/средняя | B-20 (recipe_media ai_generated) |
| R-18 | Seed начинок пишет несуществующие колонки (slug/color/suggested_price_modifier) | fillings-seed.ts:41-53 | средний/средняя (упадёт на чистой схеме) | B-21-фикс + V-3 |

### 2.5 Чат и интеграция Studio

| ID | Риск | Доказательство | Severity/Вер. | Митигация |
|---|---|---|---|---|
| R-19 | Socket-сервер обрезает неизвестные поля payload → карточка Cake Design дойдёт только через polling | chat-server/index.ts:721-734 (белый список) | высокий/высокая (без B-16) | B-16 (расширить whitelist + типы) |
| R-20 | FAQ-бот может отвечать на текст карточки дизайна | handleAutoReply читает message.text (chat-server:777-790) | низкий/средняя | Текст-маска/escape в B-16 |
| R-21 | Вложения чата не реализованы; микрофон запрещён Permissions-Policy; audio MIME не разрешён в upload-service | chat-widget.tsx:57-61; next.config.ts:130-135; upload-service.ts:24-32 | средний/высокая (если V2 требует медиа) | B-17 (пайплайн NEW) |
| R-22 | Мёртвые realtime-хуки создают ложное ощущение рабочей Supabase-интеграции | use-chat.ts/use-cake-builder.ts — 0 импортёров; нет /realtime/v1 | низкий/низкая | Удалить/задокументировать (B-26) |
| R-23 | Mock-фоллбэки в дашбордах (MOCK_ORDERS/MOCK_NEGOTIATIONS/кондитеры) могут быть приняты за реальные данные | use-real-orders.ts:129-158; store.ts:742 | средний/средняя | B-25/B-27 (изоляция фоллбэков, маркировка isStale) |

### 2.6 Платформенные

| ID | Риск | Доказательство | Severity/Вер. | Митигация |
|---|---|---|---|---|
| R-24 | UUID-snapshotter продолжает авто-коммиты (7 шт. за 2 дня) — правки владельца могут быть поглощены без ревью | reflog/HEAD 01ea73d; поглощение слогана подтверждено | высокий/высокая | Владелец: ревью diff перед push; защита ключевых путей skip-on |
| R-25 | `types.generated.ts` отстаёт от схемы (0065/0076/0043) → тихий дрейф типов | types.generated.ts:7788-7869, 3816-3840 | средний/высокая | Регенерация типов после каждого контура миграций |
| R-26 | n8n 13-order-processing ссылается на нереализованный `autoApproveEligible` | 13-order-processing.json; grep — 0 в GET /api/orders | средний/средняя | B-24: реализовать или исключить workflow |
| R-27 | Двойной формат номеров заказов (ORD- триггер vs UK- код) | 0002:531-547 vs orders/route.ts:505 | низкий/средняя | Единый генератор (B-22-пакет) |
| R-28 | Проект «Qwen»/origin устарели: origin/main от 2026-11-04, ahead 290 — история только локальная | git remote -v; ahead 290 | средний/низкая | Регулярный push по решению владельца |

## 3. Что НЕ заявляется

- Не заявляется работоспособность каких-либо изменений интеграции — **изменений кода не было**.
- Не подтверждены: применённость миграций на кластере (G-2), поведение с реальным Supabase/прод-деплоем, формат V2 (G-1), внешние вебхуки (G-5).
- Все «FEASIBLE»-вердикты (Cake Design message; approved-design snapshot) — обоснованы якорями в коде, но не реализованы и не прогнаны.
