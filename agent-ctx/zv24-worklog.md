# Z-v24 — рабочий журнал (локальное исполнение, 2026-11-11)

## Этап 1 — фактическое состояние (замер)

| Параметр | Значение |
|---|---|
| Путь | `/home/z/my-project` |
| Ветка | `main` |
| HEAD | `b126f6a8f7f11e309b10f5d9067f393913f9f0ab` (UUID-snapshot 13:42:33, ПУСТОЙ — 0 файлов) |
| История под ним | `394e241` (docs Z-v24) → `a084a4e` (fix Z-v24) → `1ceaa4b` (snapshot Z-v23) |
| Working tree | ЧИСТЫЙ (`git status --porcelain` пуст) |
| Ahead/behind | 235 / 0 (по локальному tracking ref, без fetch) |
| Stash / незавершённые операции | нет (MERGE_HEAD/rebase/CHERRY_PICK отсутствуют) |
| Защищённые upload-файлы | **ВСЕ 4 НА ДИСКЕ**, index-флаги `H`, блобы идентичны HEAD-дереву (`git diff HEAD` по путям пуст), содержимое не читалось |
| Guard | `core.hooksPath=scripts/hooks` → pre-commit → `protected-paths.sh hook-guard` — exit 0; не изменялся |
| skip-worktree | не менялся |

**Инцидент drift закрылся штатно:** в прошлой сессии 4 защищённых файла отсутствовали на диске; snapshotter при попытке коммита (13:42) вызвал pre-commit guard, который восстановил блобы (staged+worktree) — коммит ушёл пустым, файлы вернулись. Захвата удалений в историю НЕТ.

**Зомби-воскрешение №4:** НЕ произошло — в `supabase/migrations/` только `0062_cart_sync_custom.sql` + `0080_cart_remove_zombie_check.sql`; `validations/cart.ts` и `apply-0062-cart-custom-items.ts` отсутствуют.

## Этап 2 — верификация целостности фикса Z-v24

- С базового состояния (`1ceaa4b`) пути cart/migrations/runner затрагивал ТОЛЬКО `a084a4e` — посторонних изменений нет.
- Детекция дубликатов ID присутствует в обоих runner'ах (`setup.mjs`, `01-apply-migrations.sh`).
- 79 файлов миграций, дубликатов числовых префиксов — 0.
- Отчёт `docs/release/Z-V24_CART_MIGRATION_CONFLICT_RESOLUTION.md` и верификатор `scripts/verify/cart-schema-verify.mjs` на месте.

## Хронология схемы корзины (фактическая)

`0002_marketplace.sql` (cart_items: product_id NOT NULL) → `0019_missing_runtime_tables.sql` (доп. объекты) → `0062_cart_sync_custom.sql` (канон: product_id nullable, custom_config, client_ref, uq_cart_user_client_ref, kind_check, idx_cart_user_updated) → [интервал дубликата 0062_cart_custom_items 8c3b5c6→9e6a516→удалён a084a4e] → `0080_cart_remove_zombie_check.sql` (forward-repair: DROP CONSTRAINT → rescue metadata→custom_config → условный DROP COLUMN metadata). Миграции 0063–0079 cart_items не трогают (проверено).

## Повторное доказательство (эта сессия)

см. финальный отчёт `docs/release/Z-V24_LOCAL_EXECUTION_REPORT.md` (разделы A–F).

## Ограничения

- Production build: NOT RUN (OOM-история среды ~3.9GB; Next build 2.5+GB) — не считать PASS.
- Публикация: запрещена и не выполнялась.
