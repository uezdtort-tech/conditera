# 3-a — Единый CRUD рецептов + публикация/версии/права (RECIPE-02/03, Этап 3 серверного контура)

Дата: 2026-11-09. Ветка main. Спецификация: docs/product/RECIPE_01_AUDIT_AND_TARGET_ARCHITECTURE.md (RB.14–RB.16, RA.8, RA.9, RA.13).

## Созданные файлы

| Файл | Назначение |
|---|---|
| `src/lib/recipes/recipe-content.ts` | Общие серверные хелперы: generateSlug (канон, 1:1 с marketplace), coerceNumbers (numeric→number), normalizePositions (UNIQUE(recipe_id,position)-безопасность), мапперы DTO→строки детей (steps/ingredients/substitutes/variants/sources), fetchRecipeChildren (children одним DTO), assembleRecipeDto, buildRecipeSnapshot (RA.8.1), round3. |
| `src/app/api/recipes/route.ts` | POST — создание черновика (201 {id, slug, status}). |
| `src/app/api/recipes/[id]/route.ts` | GET (Resolver-гейт, полный DTO), PATCH (root+полная замена детей, восстановление из archived), DELETE (soft → archived, offerLinked). |
| `src/app/api/recipes/[id]/publish/route.ts` | POST — права/is_blocked гейты, state machine, неизменяемая версия + идемпотентность. |
| `src/app/api/recipes/[id]/rights-confirm/route.ts` | POST — одноразовое подтверждение прав (rights_confirmed=false→true). |
| `src/app/api/recipes/[id]/versions/route.ts` | GET — автор/ADMIN: список без snapshot; покупатель (активная покупка + серверно подтверждённый платёж): своя зафиксированная версия с snapshot. |
| `src/app/api/recipes/[id]/scale/route.ts` | GET — display-only пересчёт qty * N/servings_root (Resolver full обязателен), БД не пишется. |

## Ключевые решения

1. **Роли** — серверно через `getUserRoles` (user_roles, is_active). POST /api/recipes: SUPPLIER → 403; допустимые: CUSTOMER/RECIPE_DEVELOPER/CONFECTIONER/ADMIN/SUPER_ADMIN (HOME_/BUSINESS_CONFECTIONER — атрибут business_scale роли CONFECTIONER, миграция 0055 — отдельной роли в enum нет). Остальные мутации — ownership (author или ADMIN/SUPER_ADMIN через isAdmin).
2. **Resolver** — GET/[id] и scale используют resolveRecipeAccess+gateRecipeContent без дублирования; level='none' → 404 (существование не раскрывается); sources отдаются только автору/ADMIN (RB.16) до вызова gate.
3. **Идемпотентность publish** — сравнение `latest_version.created_at >= recipes.updated_at`: PATCH bump-ит updated_at при ЛЮБОМ изменении (поля корня ИЛИ замена состава — иначе чистая замена детей не создала бы новую версию). Порядок «версия → статус» делает прерванную публикацию самолечащейся (idempotent-ветка завершает переход статуса без дубля версии). version_no = max+1, retry на 23505 до 3 попыток.
4. **Модерация** — обязательный модерационный флаг в системе не найден (moderation_queue не подключён к recipes.status='pending_review' нигде в src/). Документировано в шапке publish: по умолчанию Завис-2 (draft→published напрямую); env `RECIPE_MODERATION_REQUIRED=true` → draft→pending_review без версии.
5. **SEC-11** — publish: свежая (без кэша) проверка profiles.is_blocked, fail-closed (ошибка БД → запрет).
6. **Атомарность** — PostgREST-транзакций нет: компенсирующие откаты по паттерну marketplace/route.ts (POST: rollback корня; PATCH: захват старого состояния детей → реинсерт с их id). Валидация состава — до вставки корня (422 без частичного состояния).
7. **supabase-js 2.112** — `.select(<литерал>)` парсит колонки и типирует Row; строковый (не-литеральный) аргумент даёт `data: GenericStringError` → ROOT_SELECT зафиксирован литеральным типом; union-сужение PostgREST — комбинированные проверки `if (error || !root)` (паттерн существующих маршрутов).
8. **Каскад media** — полная замена steps каскадно удаляет recipe_media шагов (ON DELETE CASCADE, 0066); манифест медиа сохраняется в снапшотах версий — задокументировано в шапке PATCH.

## Отклонения от спеки (с обоснованием)

- RB.14 «права-подтверждение фиксирует by/at»: колонок confirmed_by/confirmed_at в 0066 нет (миграции запрещены) → who/when пишется в rights_note (дефолтная строка при пустом note).
- Покупатель в /versions: дополнительно к `is_active` проверяется серверно подтверждённый платёж (та же семантика, что RA.9.5/Resolver) — иначе REVOKED_REFUND-покупатели получили бы снапшот.
- scale: substitutes.qty масштабируется по той же пропорции (task упоминал только ingredients); variants/media/steps — без изменений.
- PATCH: источников-детей замена — полная (sources[] или source) со сбросом прав (новый источник = новое подтверждение RA.13); при отсутствии массива sources не трогаются.
- Servings при отсутствии в POST: DB DEFAULT 8 сохраняется (не пишем NULL поверх).

## Проверки (факт)

- `bunx tsc --noEmit` — чисто (0 ошибок по всему проекту).
- `bun run lint` — чисто (exit 0).
- Smoke curl (без мутаций): POST /api/recipes без auth → 401 (за CSRF-гейтом proxy.ts, как все мутации проекта); GET чужого id → 404; scale без servings → 422; versions без auth → 401.

## Нерешённое / вне scope

- pending_review→published модератором: существующий /api/moderation не подключён к recipes.status — переход не создаст версию (отмечено в комментарии publish; задача отдельного этапа).
- Конкурентные PATCH-гонки по корню (last-write-wins) — RB.14 SQL-инкремент счётчиков тут неприменим (нет счётчиков в DTO).
