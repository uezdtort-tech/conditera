# CAKE PROJECT DATA MODEL PROPOSAL

**Статус:** ПРОПОЗАЛ (не реализовано). Основан исключительно на проверенной ground truth (см. CAKE_STUDIO_INTEGRATION_GROUND_TRUTH.md). Все миграции — **additive-only**, без изменения существующих колонок/контрактов API.

---

## 1. Цель

Единая сущность **Cake Project** — «проект торта», связывающая конфигурацию конструктора/Studio V2, переговоры, чат, заказ и производство, с **иммутабельным утверждённым дизайном**, отделённым от фотографий готового изделия.

## 2. Принципы

1. **Additive-only**: новые таблицы/колонки/значения; ничего не переименовывается и не удаляется; обратная совместимость живых путей (checkout idempotency, acceptance_snapshot, 0085 expiry-trigger, fail-closed pricing merge) сохраняется.
2. **Идентичность = `auth.users` UUID** для всех новых FK (согласно факту: контуры recipes/production уже на auth.users — 0010:108, 0070:5-6; легаси `confectioners.id` TEXT остаётся снаружи, через маппинг `confectioners."userId"`).
3. **Иммутабельность через отсутствие клиентских политик записи** — паттерн `recipe_versions` (0066:419-465: policies отсутствуют → пишут только service_role).
4. **JSONB со `schema_version`** для структуры конфигурации — паттерн `acceptance_snapshot` (snapshot.ts:85-97).
5. **Не смешивать дизайн и готовое изделие**: утверждённый дизайн — отдельный kind/сущность, никогда не попадает в `kind='ready_photo'`.
6. Mock-фоллбэки сохраняются как помеченные фоллбэки (не заменяются молча).

## 3. Новые таблицы (миграция 0087, эскиз)

### 3.1 `cake_projects`

| Колонка | Тип | Комментарий |
|---|---|---|
| id | uuid PK | |
| buyer_id | uuid NOT NULL → auth.users(id) | покупатель |
| confectioner_id | uuid NULL → auth.users(id) | назначается при accept/выборе; NULL до согласования |
| title | text | человекочитаемое название |
| source | text NOT NULL CHECK ('cake_builder','studio_v2_import','chat') | происхождение |
| config | jsonb NOT NULL | `CakeBuilderConfigV2` c `schema_version`; **включает** productType/tiers/shape/quantity/address — закрывает пробел потери полей (0004 drafts их не имеют; offer-format hardcode "cake") |
| status | text NOT NULL DEFAULT 'draft' CHECK ('draft','submitted','designing','approved','ordered','archived') | |
| approved_version_id | uuid NULL | FK → cake_project_versions(id); пишется ТОЛЬКО service_role при approve |
| inquiry_id | uuid NULL | заполняется после submit (или обратная ссылка из inquiries — см. §4.2) |
| created_at / updated_at | timestamptz | |

RLS: SELECT — buyer_id=self ИЛИ confectioner_id=self ИЛИ ADMIN/SUPER_ADMIN; INSERT — buyer_id=auth.uid(); UPDATE — buyer, **только пока status ≠ 'approved'/'ordered'** (после — только service_role).

### 3.2 `cake_project_versions` (иммутабельные снапшоты)

| Колонка | Тип | Комментарий |
|---|---|---|
| id | uuid PK | |
| project_id | uuid NOT NULL FK → cake_projects(id) CASCADE | |
| version_no | int NOT NULL | UNIQUE(project_id, version_no) |
| snapshot | jsonb NOT NULL | полная нормализованная конфигурация + ссылки на превью/визуализацию + **provenance-метки** (real/template/ai) по аналогии с `recipe_media.origin/ai_generated` (0066:102-110) |
| origin | text CHECK ('edit','negotiation_revision','approve','studio_import') | |
| created_by | uuid → auth.users | |
| created_at | timestamptz | |

RLS: SELECT — участники проекта ИЛИ (публикация в чате через payload). **INSERT/UPDATE/DELETE-политик для клиентов НЕТ** (service_role only) — копия контракта `recipe_versions`.

Связь с переговорами: каждое quote/counter в `negotiations` может дополнительно создавать `cake_project_versions(origin='negotiation_revision')` — но это опция фазы 2; минимум — версия на approve.

## 4. Расширения существующих таблиц (additive)

### 4.1 `chat_messages` — структурированное Cake Design сообщение

- **Вариант 0 (ноль миграций):** payload в существующем `metadata JSONB` (0004:242) / `attachments JSONB` (0004:231); `message_type` не нужен.
- **Вариант 1 (рекомендуемый):** `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text'` (+ индекс по (channel_id, created_at) уже есть; при необходимости partial index `WHERE message_type <> 'text'`). Колонка позволяет фильтровать карточки без парсинга JSONB.
- Точки касания кода: см. BACKLOG B-16 (POST messages route, fetchRoomMessages, типы, маппер, рендер-ветка в chat-widget, `doSend`, **белый список полей socket-сервера** `chat-server/index.ts:721-734` — без него карточка дойдёт до получателя только после polling).

### 4.2 `inquiries` — ссылка на проект

`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS cake_project_id uuid NULL REFERENCES cake_projects(id) ON DELETE SET NULL;`
Прежний флоу `cake_builder_drafts` сохраняется и помечается legacy (не удалять — живые RLS/код). Это закрывает расхождение интерфейс↔БД №1 аудита (потеря productType/tiers/shape/quantity/address).

### 4.3 `order_media` — утверждённый дизайн как immutable snapshot

**Ноль миграций по схеме**: `kind` — free text (0054:192, CHECK отсутствует), `media_type` ограничен 'photo' — использование существующего photo-пайплайна.

- Новое значение kind: **`approved_design`** (+ опционально `design_reference` для референсов до утверждения).
- Хранение: `orders/<orderId>/published/designs/<uuid>.<ext>` — подкаталог отделяет дизайн от `photos/` (текущий код строит путь в `order-media.ts:110-115`; расширение константы).
- В `metadata` строки order_media (доступна? — нет, свободного metadata-колонки в 0054 нет → хранить связь в `domain_events.payload` и/или в имени файла/`original_filename`; при необходимости additive-колонка `metadata jsonb` в 0089).
- Права: текущий upload-маршрут разрешает только `canOperateOrder` (кондитер/admin) — `media/route.ts:52`. Для approved_design правило: файл кладёт кондитер (или система при approve), **подтверждение** покупателя фиксируется событием `cake_design.approved` в `domain_events` (append-only, dedup_key 0060:33-38) — там же хэш контента (SHA-256) для tamper-evidence.
- Иммутабельность: статус-машина order_media уже имеет только approved/deleted (0054:194); для approved_design запретить soft-delete через правило в lib (whitelist-константы в `order-media.ts` и `media/route.ts`).
- **Почему не `orders.metadata`**: `orders_update_own` (0002:437-445) позволяет покупателю UPDATE строки заказа любым authenticated PostgREST-клиентом → metadata не является tamper-proof.

## 5. Поток данных (end-to-end)

```
CakeBuilderPage / Studio V2
  → autosave черновика: cake_projects(status='draft') + cake_project_versions(origin='edit')   [NEW]
  → submit: POST /api/inquiries {cakeProjectId, confectionerIds}
      → inquiries.cake_project_id + negotiations (N ≤ 5) — без изменений
  → переговоры: quote/counter/accept — без изменений (valid_until 14d, 0085-триггер жив)
  → approve: service_role пишет cake_project_versions(origin='approve')
      → cake_projects.approved_version_id + status='approved'
      → чат: structured cake_design message (metadata.message_type='cake_design')
      → domain_events: cake_design.approved {hash, version_id}
  → checkout: как сегодня (negotiation binding, selected_attributes, acceptance_snapshot)
      + POST /api/orders/[id]/media kind='approved_design' (файл из approved-версии)
      → заказ содержит: дизайн (order_media/designs) ≠ фото готового изделия (order_media/photos)
  → производство: acceptance_snapshot / write-off — без изменений
```

## 6. Маппинг существующих сущностей → модель

| Существующее | Роль в модели Cake Project | Решение |
|---|---|---|
| `cake_builder_drafts` (0004:43-66) | legacy-черновик (без productType/tiers/shape) | сохраняется, помечается legacy; новые черновики — cake_projects |
| `CakeBuilderConfig` (cake-builder-pricing.ts:25-43) | база `config.schema_version=1` | расширить типом, включающим tiers/shape/quantity/address |
| `negotiations` + `negotiation_revisions` (0004:109-163) | история ценовых предложений | без изменений; опц. зеркало в cake_project_versions |
| `order_items.selected_attributes` (checkout:463-472) | конфиг внутри заказа | без изменений (уже полный снапшот) |
| `orders.metadata.acceptance_snapshot` | производственный снапшот состава | без изменений; **резерв recipe_version_id начать заполнять** (snapshot.ts:439-440) — отдельное решение |
| `order_media.kind='ready_photo'/'handoff_photo'` (0054) | фото готового изделия | без изменений |
| `order_media.kind='approved_design'` | **утверждённый дизайн** | NEW значение |
| `chat_messages.metadata/attachments` (+опц. message_type) | карточка дизайна в чате | NEW payload |
| `recipe_versions` (0066) | паттерн иммутабельности | REUSE паттерна |
| `domain_events` (0053) | tamper-evident журнал событий дизайна | REUSE |
| `product_slices` (0017) | витринные фото-разрезы | вне модели (каталог), но API-разрез (slices) может читать approved_design как источник? — НЕТ: витрина ≠ заказ |

## 7. Открытые вопросы (для владельца)

1. Нужен ли отдельный бакет/подкаталог для design-файлов до заказа (сейчас предзаказные файлы можно держать в бакете `media` через `/api/upload`, а ссылку — в version snapshot).
2. Заполнять ли `recipe_version_id` в acceptance_snapshot (поле зарезервировано, всегда null).
3. Разрешать ли покупателю загружать design-reference файлы (сейчас order_media — только кондитер/admin).
4. Studio V2-импорт: формат Cake Project неизвестен (архив отсутствует, V-2) — `source='studio_v2_import'` и конвертер в `config` проектируются после получения архива.

## 8. Последовательность миграций (эскиз, additive-only)

| № | Содержимое | Откат |
|---|---|---|
| 0087_cake_projects | таблицы cake_projects + cake_project_versions + RLS + индексы | DROP TABLE (безопасно, ничего не ссылается) |
| 0088_inquiries_cake_project_link | +колонка inquiries.cake_project_id | DROP COLUMN |
| 0089_chat_message_type (опция) | +колонка chat_messages.message_type DEFAULT 'text' | DROP COLUMN |
| 0090_order_media_design_metadata (опция) | +колонка order_media.metadata jsonb (связь version_id/hash) | DROP COLUMN |

Никаких CHECK на существующие enum/free-text колонки не добавляется (kind остаётся free text — контроль на уровне приложения, чтобы не сломать существующие строки).

## 9. Критерии приёмки модели

1. `git diff` миграций содержит только CREATE TABLE/ADD COLUMN/CREATE POLICY — ни одного ALTER/UPDATE/DROP существующих данных.
2. Иммутабельность: у cake_project_versions и approved_design-строк order_media нет клиентских путей записи/удаления (проверка: grep-матрица + RLS spot-check по образцу `scripts/db/rls-spot-check.cjs`).
3. Живые флоу не затронуты: checkout idempotency, /api/inquiries, /api/negotiations/[id], acceptance_snapshot, write-off RPC 0081, 0085-триггер — тесты (существующие 48/48 cart-домена и vitest-набор) проходят без правок.
4. Потерянные поля (productType/tiers/shape/quantity/address) присутствуют в `cake_projects.config` и попадают на checkout без hardcode «cake».
