# IMPLEMENTATION BACKLOG (Cake Studio V2 × Conditera)

**Правила:** каждый пакет — небольшой, независимо приёмопригодный; зависимости явные; ничего не переносится из V2 автоматически; миграции additive-only; защищённые upload-маршруты не изменяются. Приоритеты: P0 — разблокировка окружения, P1 — закрытие критических рисков, P2 — Cake Project Core, P3 — дизайн-снапшот и чат, P4 — визуализация, P5 — консолидация, P6 — Studio V2 импорт.

---

## P0 — Разблокировка окружения (решения владельца)

### B-0. Восстановить 4 защищённых upload-маршрута (drift)
- **Зависимости:** нет. **Риск:** R-… G-3. **Объём:** S.
- Действие: `bash scripts/protected-paths.sh repair` (точечное восстановление из последнего хорошего коммита; без reset/checkout); затем `skip-on` по решению владельца.
- **Приёмка:** `git status` без удалений MANDATORY_PATHS; `POST /api/upload` отвечает 401/200 (не 404); pre-commit hook-guard в исходном виде.

### B-1. Инициализация embedded PostgreSQL
- **Зависимости:** нет. **Объём:** S.
- Действие: `node scripts/db/runtime.mjs start` (+ setup.mjs) — вне READ-ONLY, по решению владельца.
- **Приёмка:** ledger `schema_migrations` = 85/85; `scripts/db/rls-spot-check.cjs` зелёный; V-1 закрыт.

### B-2. Передача архива `conditera_cake_studio_v2.zip`
- **Зависимости:** нет (владелец). **Объём:** —.
- **Приёмка:** архив в `upload/` или `/home/z`; повторный read-only аудит §6 задачи (инвентаризация модулей, Windows-зависимости, Cake Project формат) с заполнением VERIFY-пунктов карты.

## P1 — Закрытие критических рисков безопасности/схемы

### B-3. Сузить RLS `recipe_ingredients` («миграция 0073»)
- **Зависимости:** B-1 (проверка на кластере). **Риск:** R-11. **Объём:** M.
- Действие: новая additive-миграция: отозвать широкую политику 0053, ввести read = author ИЛИ published-parent (по образцу recipe_steps 0066:62-71); сервисные пути (write-off, breakdown) идут под service_role — не пострадают.
- **Приёмка:** spot-check RLS: не-автор не видит ингредиенты непубличного рецепта; API breakdown/write-off тесты зелёные.

### B-4. `product_slices`: RLS + ownership на DELETE
- **Зависимости:** B-1. **Риск:** R-12. **Объём:** S.
- Действие: политика SELECT/INSERT/UPDATE/DELETE через владельца продукта (products.confectioner_id → confectioners."userId") или API-guard; ре-проверка confectioner_id в DELETE-ветке `slices/route.ts`.
- **Приёмка:** не-владелец получает 403/404; витринные slice-эндпоинты работают.

### B-5. Убрать `supabaseAdmin` из браузерного `use-escrow.ts`
- **Зависимости:** V-8 (найти точки монтирования). **Риск:** R-13. **Объём:** M.
- Действие: переписать на API-роуты (админ-эндпоинт) или удалить мёртвый файл.
- **Приёмка:** grep `supabaseAdmin` в `src/lib/supabase/use-escrow.ts` = 0; затронутые UI прогнаны.

### B-6. Заполнять `uploads`-реестр (0015)
- **Зависимости:** B-0. **Риск:** R-15. **Объём:** S.
- Действие: в `upload-service.ts` после успешного `storage.upload` вставлять строку реестра (url, mime, size, category, uploaded_by).
- **Приёмка:** после загрузки файла строка в `uploads` с корректным url; тест upload-oversize-verify зелёный.

### B-7. Убрать запись `payment_status:'failed'` (вне enum)
- **Зависимости:** B-1. **Риск:** R-8. **Объём:** S.
- Действие: в `orders/route.ts:619` заменить на корректное значение (оставить `pending`) + запись причины в metadata/домен-событие.
- **Приёмка:** сценарий бонус-фейла завершается без 500; enum-значения валидны.

### B-8. Ликвидировать legacy `/api/quotes` units bug
- **Зависимости:** решение владельца (retire vs fix). **Риск:** R-5. **Объём:** S (retire) / M (fix).
- **Приёмка (retire):** fallback-ветка удалена из `cake-builder-page.tsx`; `quote_requests` не растёт; основной флоу inquiries не затронут (48/48 + vitest).

## P2 — Cake Project Core (модель)

### B-9. Миграции 0087-0089 (cake_projects, cake_project_versions, inquiries.cake_project_id, опц. chat_messages.message_type)
- **Зависимости:** B-1; согласие владельца на DATA_MODEL. **Риск:** R-1. **Объём:** L.
- **Приёмка:** diff = только CREATE/ADD COLUMN/POLICY; RLS spot-check (версии без клиентских записей); откат = DROP (без потери данных); vitest полный — зелёный.

### B-10. Autosave черновика конструктора в cake_projects
- **Зависимости:** B-9. **Объём:** M.
- Действие: debounce-сохранение `CakeBuilderConfig` (вкл. tiers/shape/quantity/address) в cake_projects(status='draft') + версия на значимые изменения; старый draft-флоу остаётся.
- **Приёмка:** перезагрузка страницы восстанавливает проект; undo/redo не ломается (cake-builder-history тест).

### B-11. Источник опций из DB (`builder_config`) + восстановление шага 2.5
- **Зависимости:** B-9 (config schema v2). **Риск:** R-3. **Объём:** M.
- Действие: `cake-builder-pricing.ts` читает опции из `builder_config` (seed из mock), клиент получает их через API; tiers/shape получают переход `step:2.5` и попадают в формулу.
- **Приёмка:** изменение цены в админке меняет цену конструктора без релиза; tiers/shape фигурируют в `selected_attributes` и в счёте.

### B-12. Единая точка входа: ретируем mock-submit CakeBuilderDialog
- **Зависимости:** B-10 (чтобы hero-CTA не терял данные). **Риск:** R-2. **Объём:** S.
- Действие: hero/banner CTA открывают `/cake-builder` (или dialog → redirect/наследник страницы); mock-submit удалён.
- **Приёмка:** из home-CTA создаётся реальная заявка (draft+inquiry в БД); e2e U-05 обновлён.

### B-13. Включить `resolveCustomConfectioner` в checkout
- **Зависимости:** нет (независимый фикс). **Риск:** R-4. **Объём:** S.
- **Приёмка:** кастом-заказ получает confectioner_id из витрины/заявки; тест confectioner-assignment зелёный; ручной заказ = кондитер видит заказ.

### B-14. Расширить submit/inquiries: полная конфигурация
- **Зависимости:** B-9 (или, без B-9: additive-колонки product_type/tiers/shape/quantity + address в drafts/inquiries). **Риск:** R-1. **Объём:** M.
- **Приёмка:** accept→checkout восстанавливает конфигурацию без hardcode «cake» (тест offer-format обновлён); кондитер видит полный состав заявки.

## P3 — Утверждённый дизайн и чат

### B-15. `order_media.kind='approved_design'` (immutable снапшот)
- **Зависимости:** B-9 (approved_version_id) желательна, иначе — снапшот из `selected_attributes`. **Объём:** M.
- Действие: константы kind в `order-media.ts` + `media/route.ts`; подкаталог `designs/`; запрет soft-delete для нового kind; правило: загрузка — кондитер/admin, подтверждение покупателя — `domain_events` `cake_design.approved` (+SHA-256 хэш).
- **Приёмка:** дизайн и ready_photo не пересекаются (фильтры по kind в gates/lifecycle не затронуты — тесты 0054-контура); байты доступны только участникам заказа; событие в timeline.

### B-16. Структурированное сообщение Cake Design в существующем чате
- **Зависимости:** B-9/`config`; независимая часть — при metadata-payload. **Риск:** R-19/R-20. **Объём:** M.
- Действие (8 точек): POST `messages` route (payload, MAX_TEXT-обход) → `fetchRoomMessages` маппер → `ChatMessage`/`ApiChatMessage` типы → `mapApiMessageToChatMessage` → ветка рендера в chat-widget (рядом с voice-веткой :931-942) → `doSend` payload → **socket whitelist (`chat-server/index.ts:721-734`)** → FAQ-бот skip-правило для cake_design.
- **Приёмка:** verify-chat-runtime.mjs + новый сценарий: карточка приходит обоим участникам **в реалтайме** (не только по polling); бот не отвечает на карточку; idempotency не дублирует.

### B-17. Пайплайн вложений чата (если V2 требует медиа)
- **Зависимости:** B-0 (роуты), решение о бакете (media vs оживление messages-бакета + audio MIME). **Риск:** R-21. **Объём:** L.
- **Приёмка:** отправка изображения в чате → файл в бакете → `attachments[]` в сообщении → рендер у получателя; голос: снять Permissions-Policy-ограничение ИЛИ отложить (решение владельца).

## P4 — Визуализация разреза (provenance A/B/C)

### B-18. SliceConfig из реальных данных
- **Зависимости:** нет жёстких. **Риск:** R-16. **Объём:** L.
- Действие: приоритет источника: `product_slices.image` (A) → `fillings.slice_config` (кондитер сохранил) → генерация из `recipe_ingredients`-групп (для заказов со снапшотом) → `detectPreset` (B, помечен «шаблон») → AI (C, помечен).
- **Приёмка:** в UI разреза видна метка происхождения; тесты detectPreset-фоллбэка зелёные; карточки U-06 не регрессируют.

### B-19. Подключить CakeVisualPreview в builder (живое превью)
- **Зависимости:** B-11 (DB-палитра color_code). **Объём:** S.
- **Приёмка:** превью в шагах отражает конфиг (вкл. DB-начинки), cake-visual-map тест расширен.

### B-20. Provenance-метки AI-изображений
- **Зависимости:** нет. **Риск:** R-17. **Объём:** S.
- Действие: ai-photo/ai-generate-slice пишут пометку (`recipe_media.origin='ai_generated'`/`ai_generated=true` либо metadata продукта).
- **Приёмка:** AI-фото отличимо от авторского в админке и (при желании) на витрине.

## P5 — Консолидация легаси

### B-21. Починка `fillings-seed.ts` (реальные колонки)
- **Зависимости:** B-1 (V-3). **Объём:** S. — `slug/color/suggested_price_modifier` → `color_code`/убрать/смэпить на `price_multiplier`.
- **Приёмка:** seed проходит на migration-only схеме; fillings/list отдаёт данные.

### B-22. Одна матрица lifecycle + один формат номера
- **Зависимости:** нет. **Риск:** R-6/R-27. **Объём:** M.
- Действие: PATCH `/api/orders/[id]` делегирует в `ops/lifecycle.ts` (или помечается deprecated); генератор номера — единый.
- **Приёмка:** order-lifecycle-verify 100%; переходы конфликтных ролей идентичны в обеих матрицах.

### B-23. Ретиро `escrow_accounts`+0011-триггер (параллельный ledger)
- **Зависимости:** V-5. **Риск:** R-6. **Объём:** M.
- **Приёмка:** живой путь (payment_status + release_escrow_order) не изменён; легаси-таблица закрыта от записей (RLS/policy), UI-хуки use-escrow отмонтированы.

### B-24. n8n `autoApproveEligible`: реализовать или исключить
- **Зависимости:** решение владельца. **Риск:** R-26. **Объём:** S.
- **Приёмка:** либо GET /api/orders поддерживает параметр (фильтр верифицированных), либо workflow удалён/переписан.

### B-25. Типы заказов из БД; изоляция mock-фоллбэка
- **Зависимости:** нет. **Риск:** R-23/R-25. **Объём:** M.
- Действие: `OrderStatus/paymentStatus` → производные от enum/конфига; `IN_PROGRESS/DELIVERING/DISPUTE` удалены из живых поверхностей; mock-fallback только с явным banner «демо-данные».
- **Приёмка:** grep DISPUTE в живом UI = 0; адаптеры use-real-orders покрыты тестами.

### B-26. Удаление мёртвых realtime-хуков и dormant-чат-роутов
- **Зависимости:** нет. **Риск:** R-22. **Объём:** S.
- **Приёмка:** supabase-hooks.test обновлён; verify-chat-runtime зелёный; grep `.channel(` вне тестов = 0.

### B-27. Идентичность: план перехода `confectioners.id` TEXT → auth.users UUID
- **Зависимости:** P2-завершение. **Объём:** L (фазированный).
- **Приёмка (фаза 1):** все NEW-модули только на auth.users; документ-маппинг `confectioners."userId"`; фаза 2 — отдельное решение.

## P6 — Cake Studio V2

### B-28. Инвентаризация и маппинг V2 (после B-2)
- **Зависимости:** B-2. **Объём:** M (аудит).
- Действие: распаковка в /tmp (НЕ в репозиторий), инвентаризация модулей/форматов/Windows-зависимостей, маппинг на cake_projects/config, список REUSE/ADAPT/REPLACE/NEW для V2-модулей.
- **Приёмка:** обновлённые INTEGRATION_MAP/BACKLOG (сняты VERIFY/BLOCKED V-2); решение владельца о переносе.

---

## Граф зависимостей (упрощённо)

```
B-0 ──► B-6, B-17
B-1 ──► B-3, B-4, B-7, B-21, (проверки всех миграций)
B-2 ──► B-28
B-9 ──► B-10 ──► B-12
B-9 ──► B-14, B-15, B-16
B-11 ──► B-19
B-13, B-22, B-23, B-24, B-25, B-26 — независимы
B-27 — после P2
```

## Глобальные критерии приёмки волны интеграции

1. Существующий тестовый набор (vitest: cart 48/48, cake-builder-pricing/history/options, snapshot*, checkout-idempotency; e2e auth/full-flow) зелёный до и после каждого пакета.
2. Ни один пакет не меняет: защищённые upload-маршруты, контракт `/api/cart`, acceptance_snapshot-схему (кроме добавления recipe_version_id по отдельному решению), 0085-триггер.
3. Каждый пакет добавляет/обновляет свой verify-скрипт в `scripts/verify/` (паттерн проекта).
4. Никаких push/деплоя без явной команды владельца.
