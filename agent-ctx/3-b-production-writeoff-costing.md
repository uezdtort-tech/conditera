# 3-b — Производственный контур: карты, версии, партии, batch-RPC списание, себестоимость

Дата: 2026-11-09. Ветка main. Спека: docs/product/RECIPE_01_AUDIT_AND_TARGET_ARCHITECTURE.md (RA.11:815-878, RA.12:878-899, RB.14:1430-1456, RB.15:1458-1470, RB.16:1472-1495).

## Создано/изменено

| Файл | Что |
|---|---|
| `src/lib/recipes/cost.ts` | Единый серверный калькулятор себестоимости (RA.12): `calcCardCost(norms, prices, batch)` → costPerUnitRub/costPerBatchRub (целые рубли) + breakdown с копейками ТОЛЬКО внутри JSONB; конвертация единиц `convertQty`/`parseUnit` (г↔кг, мл↔л, шт; масса↔объём запрещена); цены — только серверные `inventory_items.cost_per_unit` (INTEGER рубли, 0010:226) |
| `src/lib/recipes/production.ts` | Общие хелперы контура: PRODUCTION_ROLES (ПР-6, SUPPLIER→403), parseCardNormsInput, findForeignInventoryItems (склад owner-only, 0010), buildCardSnapshot/canonicalJson (идемпотентность approve), serializeCard/serializeIngredient (whitelist, «видимость себестоимости» = владелец), BatchRow/serializeBatch |
| `src/app/api/production/cards/route.ts` | POST (201 draft; валидации recipe/версии/склад/UNIQUE(owner,product)→409; компенсирующее удаление при сбое детей) / GET (свои; ADMIN все; нормы только владельцу; latest_version_no) |
| `src/app/api/production/cards/[id]/route.ts` | PATCH (owner-only; контент только в draft; approved→draft, archived→draft, draft/approved→archived; status:'approved' через PATCH → 409; замена норм DELETE→INSERT с компенсацией) + GET одной карты |
| `src/app/api/production/cards/[id]/approve/route.ts` | POST (owner-only): гейт «все нормы привязаны» → 422; атомарная связка card_version (version_no=max+1, snapshot=корень+нормы+content+cost) + recipe_card_cost_history (price_basis='inventory_current') + UPDATE cards approved; повтор без правок → 200 idempotent:true (сравнение canonicalJson(snapshot.content)); 23505 гонка → replay |
| `src/app/api/production/batches/route.ts` | POST (владелец карты через card_version; planned_unit канон г/мл/шт; order_id проверяется на confectioner_id) / GET (свои +filters card_version_id/status; ADMIN все) |
| `src/app/api/production/batches/[id]/route.ts` | PATCH (owner-only; RB.15: planned→in_progress, in_progress→completed (гейт: наличие inventory_write_offs.batch_id иначе 409 «партия без списания»), planned/in_progress→cancelled; completed/cancelled финальные) |
| `src/app/api/inventory/write-off/route.ts` | Расширен batch-режимом: `{batch_id, items}` → ownership/статус-гейт (completed/cancelled→409) → валидация против НОРМ СНАПШОТА card_version (qty_per_unit×(1+waste_pct)×planned_qty из БД, допуск 5%, чужой/избыточный/дубликат→422, обязательные нормы все должны присутствовать) → конвертация qty к единицам складских позиций → signature=sha256 sorted `item_id:quantity` → idempotency_key=`pb:{batch_id}` → supabaseAdmin.rpc('apply_inventory_write_off_batch', …) ОДНА попытка; PGRST202→fail-closed 500; RAISE-коды маппятся (insufficient→409, unit_mismatch→422, forbidden_item→403, not_found→404, bad_item→400). Order-путь НЕ тронут (тест проходит) |

## Ключевые факты, сверенные с БД

- RPC `apply_inventory_write_off_batch(p_owner_id, p_items, p_order_id, p_batch_id, p_idempotency_key, p_signature)` — INVOKER, GRANT только service_role; p_items формат **`[{item_id, quantity, unit?}]`** (0071:105,182-184) — НЕ `inventory_item_id/qty`, как гипотетически в ТЗ; имена полей в маршруте сведены к факту (алиасы item_id|inventory_item_id, quantity|qty принимаются на входе, нормализуются перед RPC).
- `recipe_production_card_versions` НЕ имеет колонки created_by (0070:128-139) — автор версии фиксируется в `approved_by`.
- `recipe_card_cost_history`: cost_per_unit_rub/cost_per_batch_rub INTEGER (целые рубли), копейки только в breakdown JSONB.
- Частичный UNIQUE(owner_id, product_id) на карты (0070:41-43); UNIQUE batch_id / idempotency_key на write_offs (0071:57-63).

## Проверки (факт, 11:09–11:15)

- `bunx tsc --noEmit` (полный репо, 11:09) — 0 ошибок. ПОВТОРНЫЙ полный прогон (11:14) падает на **чужом WIP-файле параллельного агента 3-a**: `src/app/api/recipes/[id]/route.ts` (GenericStringError, строки 193-206) — файл появился между прогонами (git status: untracked recipes/[id]/route.ts, publish/, rights-confirm/, scale/, versions/). Файлы задачи 3-b этого не касаются.
- Скоуп-проверка своих файлов: `bunx tsc -p tsconfig.task3b-check.json` — **OK** (cost.ts, production.ts, production/**, write-off + deps).
- `bun run lint` (полный) — exit 0, чисто.
- `bunx vitest run src/app/api/inventory/write-off.idempotency.test.ts` — **7/7 passed** (order-путь не регрессировал).

## Открытые пункты / заметки для следующих агентов

1. **SEC-6 не закрыт**: `PATCH /api/inventory/items` по-прежнему позволяет менять `quantity` (route.ts:198-203) — по ТЗ НЕ исправлять молча, отдельное решение.
2. Роли `BUSINESS_CONFECTIONER`/`ENTERPRISE` отсутствуют в enum `user_role` (types.ts); whitelist допускает их заранее, фактически работают CONFECTIONER/ADMIN/SUPER_ADMIN.
3. `POST /api/inventory/movements` всё ещё принимает order_id (RA.11.5.1 — лишить права в RECIPE-03).
4. Семантика масштабирования партии: expected = qty_per_unit × planned_qty (норма определена «на единицу planned_unit выпуска»); UI карты и партии должен строить количества по этому же правилу.
5. Статусы партии: списание не меняет статус; completed ставит только PATCH (гейт «партия без списания»).
