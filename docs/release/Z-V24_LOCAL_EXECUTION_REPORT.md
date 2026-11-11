# Z-V24 — LOCAL EXECUTION REPORT (CART MIGRATION BLOCKER FIX)

**Дата:** 2026-11-11 · **Режим:** локальное исполнение, публикация запрещена и не выполнялась.

## A. Ground Truth

| Параметр | До работ (замер) | После работ |
|---|---|---|
| HEAD | `b126f6a` (UUID-snapshot 13:42:33, ПУСТОЙ) | `b126f6a` + локальный commit Z-v24 (см. git log) |
| Ветка | `main` | `main` |
| Working tree | чистый | чистый (после коммита отчёта) |
| Ahead/behind | 235 / 0 (без fetch, локальный tracking ref) | 236 / 0 |
| Незакоммиченные изменения | нет | нет |
| Защищённые upload-файлы | 4/4 на диске, блобы = HEAD, guard exit 0 | без изменений |
| Зомби-миграция 0062_cart_custom_items | отсутствует (не воскресла) | отсутствует |

История под HEAD: `a084a4e` (fix Z-v24, прошлое выполнение) → `394e241` (docs) → `b126f6a` (snapshot). Число ahead 232 из прежних отчётов устарело — фактическое значение зафиксировано выше.

## B. Причина блокера

**Подтверждена независимым воспроизведением (эта сессия и предыдущая):**

- Канонический контракт: `0062_cart_sync_custom.sql` — custom-позиция = `product_id IS NULL` + `custom_config` (CHECK `cart_items_kind_check`).
- Зомби-дубликат `0062_cart_custom_items.sql` (воскрешён `9e6a516` после аудита `eabf28a`) добавлял CHECK `cart_items_product_or_custom_check`: `product_id IS NOT NULL OR (metadata IS NOT NULL AND metadata ? 'custom')`.
- Приложение (`POST /api/cart`, `src/app/api/cart/route.ts:257-266`) пишет custom-позицию БЕЗ `metadata` → на чистой установке (обе 0062 применялись лексикографически) INSERT нарушал зомби-CHECK.

Конкретный SQL воспроизведения (синтетические данные, изолированная PG 18.4):
```sql
INSERT INTO public.cart_items (user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, updated_at)
VALUES ($1, 'zv24-r2', NULL, 1, NULL, '{"weight":"1kg","fillings":[]}', NULL, now());
-- SQLSTATE 23514, constraint cart_items_product_or_custom_check, таблица cart_items
```
Путь до API: pg 23514 → supabaseAdmin.insert error → `route.ts:317` throw → catch `route.ts:320-323` → **HTTP 500 «Ошибка добавления в корзину»**. Обрабатывается как 500, потому что ошибка БД не различается по коду (23514 не перехватывается как доменная 4xx).

**После исправления** тот же сценарий на чистой установке и через живой HTTP (`POST /api/cart` с валидным `custom_config`): **HTTP 200 `{"ok":true,"mode":"inserted"}`**.

## C. Исправление

Стратегия **B+C** (обоснование необходимости комбинации: зомби успел применяться в локальных БД после 9e6a516 → одной правкой runner'а существующие БД не починить; одним forward без runner-фикса класс дефекта воспроизводится заново):

| Файл | Изменение |
|---|---|
| `supabase/migrations/0062_cart_custom_items.sql` | удалён (зомби-дубликат) |
| `supabase/migrations/0080_cart_remove_zombie_check.sql` | forward: DROP CONSTRAINT **до** переноса данных (порядок критичен — доказано), rescue `metadata→custom_config` полнотью (без потерь), условный DROP COLUMN metadata только при 0 непустых строк |
| `scripts/apply-0062-cart-custom-items.ts`, `src/lib/validations/cart.ts` | удалены (footgun + мёртвая зомби-схема, 0 импортов) |
| `scripts/db/setup.mjs` | детекция дубликатов ID ДО SQL; fail-fast (seeds после ошибки миграции не выполняются); лог причины |
| `supabase/init-scripts/01-apply-migrations.sh` (CI) | детекция дубликатов ID до применения |
| `scripts/init-db.sh` | ON_ERROR_STOP=1, учёт отказов, честный exit 1 |
| `scripts/verify/cart-schema-verify.mjs` | регрессионный верификатор |

Сохранность данных: rescue копирует `metadata` ЦЕЛИКОМ в `custom_config`; при непустой metadata колонка сохраняется (NOTICE); kind_check валидирует спасённые строки. Вариант A (правка старой миграции) отклонён: она применялась (локальные БД после 9e6a516). Совместимость: леджеры существующих БД не переписывались; 0063–0079 cart_items не трогают.

## D. Тесты

| Проверка | Результат | Доказательство |
|---|---|---|
| Чистая PostgreSQL 18.4 (`SELECT version()` = 18.4) | PASS | `cart-schema-verify.mjs` exit 0 (дисклеймер-БД, самоудаляется) |
| Все миграции (79, порядок штатный) | PASS | db:setup exit 0, ledger=79, дубликатов 0 |
| Обновление существующей БД (легаси-зомби сконструирован явно) | PASS | `agent-ctx/zv24-scenario-b.mjs` exit 0 — **18/18** (B1 ремонт+данные целы, B2 идемпотентность, B3 no-op) |
| Custom item (SQL-уровень) | PASS | verifier: «custom-позиция вставляется» |
| Custom item (HTTP `POST /api/cart`) | PASS | **200 {"ok":true,"mode":"inserted"}** (было 500/23514); dedup re-POST → 200 updated; PATCH → 200; DELETE → 200 |
| Обычный товар (HTTP + SQL) | PASS | 200 inserted; verifier PASS |
| Некорректные состояния (both/none/qty=0/dup ref) | PASS | verifier: отклонены 23514/23505 как задумано |
| Некорректный custom (валидация) | PASS | HTTP 422 «Неизвестный тип изделия» — fail-closed до БД |
| Изоляция (чужая корзина) | PASS | HTTP GET другого юзера → 0 items; юнит-тесты владения (route.test.ts) в vitest |
| Checkout / идемпотентность | PASS | checkout-idempotency exit 0 |
| Конкурентные операции | PASS | inventory-concurrency **8/8** (U-11) |
| RLS cart_items | PASS | relrowsecurity=true; политики cart_select/insert/update/delete_own (каталог); Z-v21 spot-check подхода |
| Order lifecycle | PASS | **81/81** |
| Diagnostics | PASS | **16/16** |
| Ops center | PASS | **37/0** |
| Route error coverage | PASS | 47/48 (базлайн: 1 маршрут вне периметра) |
| Backup verify/restore | PASS | RESTORE-VERIFY: PASSED |
| Runner-тесты (дубликат/SQL-ошибка/подключение/повтор) | PASS | **4/4** |
| Vitest полный | PASS | **1571/1571** (109 файлов) — красные 4 из прошлой сессии исчезли после самолечения guard'а |
| TypeScript | PASS | exit 0 |
| ESLint | PASS | exit 0 |
| Production build | NOT RUN | OOM-история среды (~3.9GB; Next build 2.5+GB) — не считать PASS |

## E. Защита

- Защищённые upload-файлы: **не читались, не изменялись, не восстанавливались вручную** (вернулись на диск штатной работой hook-guard при snapshot-коммите 13:42; блобы = HEAD, проверено `git diff HEAD` по путям — пусто).
- Hooks / `core.hooksPath` / `protected-paths.sh` / skip-worktree: **не изменялись** (guard exit 0 до и после).
- Секреты: не выводились (токены теста в /tmp, удалены; .env/.env.local gitignored, в diff не входят).
- Публикация: **git push / merge / deploy / PR не выполнялись**; все изменения локальны.
- Рабочие БД: не очищались/не пересоздавались; disposable-БД Z-v24 созданы и удалены только собственные (итог в кластере: `conditera` + `postgres`).

## F. Итоговый статус

**`Z-V24 PASS`** — причина блокера доказана воспроизведением (SQLSTATE 23514 → HTTP 500) и устранена; чистая установка и обновление существующей БД работают на PostgreSQL 18.4; все обязательные проверки пройдены в этой сессии; единственный непрогнанный пункт — production build (NOT RUN, OOM-ограничение среды, задокументирован).

Следующий этап: ожидание указаний владельца; публикация не выполняется.
