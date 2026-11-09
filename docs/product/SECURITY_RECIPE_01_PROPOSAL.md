# SECURITY-RECIPE-01 — Пропозал сужения РОВНО 10 политик `USING (true)` (0053/0054) → миграция 0073

**Статус:** PROPOSED — план, НЕ применён, НЕ активирован (документ восстановлен по факту ledger после утраты оригинала коммита `0b0009f` при откате среды).
**Git HEAD:** `0722dad` (main) · **Дата:** 2026-11-09
**Источники:** `docs/product/RECIPE_01_AUDIT_AND_TARGET_ARCHITECTURE.md` (SEC-1/Ф-10/Q-7: 957, 982, 1375, 1524, 1559); `0074:26-27` — номер **0073 ЗАРЕЗЕРВИРОВАН** за SECURITY-RECIPE-01; `0077:19-20,184` — в RELEASE-03 сужение сознательно НЕ выполнялось.
**Верификация состава:** `grep 'USING (true)' supabase/migrations/005[34]*` — ровно **10** вхождений, все `FOR SELECT TO authenticated` (5 в 0053, 5 в 0054); других `USING (true)`-политик в ledger нет.

---

## 0. ДИСКЛЕЙМЕР

> **ПРИМЕНЯЕТСЯ ТОЛЬКО ПОСЛЕ УТВЕРЖДЕНИЯ Q-7 ВЛАДЕЛЬЦЕМ.**
> 1. GRANT для `anon`/`authenticated` **не выдаются ни до, ни после** применения; существующая GRANT-конфигурация не меняется (в т.ч. blanket `GRANT SELECT ON ALL TABLES IN SCHEMA public` — 0002:572). Сужение делается на уровне RLS, а не GRANT.
> 2. **Латентность в текущей GRANT-конфигурации:** риск «10 политик без owner-условий» (RECIPE_01:1375) латентен — клиентского кода, читающего эти таблицы напрямую, нет (§2). Миграция устраняет поверхность атаки, а не реагирует на инцидент; «высокий при выдаче GRANT без сужения» — не материализуется, т.к. GRANT не выдаются.
> 3. **Environment-dependent:** эффект наблюдается только под реальными ролями PostgREST (`anon`/`authenticated`); серверные пути `getPool()`/`supabaseAdmin` (`service_role`, BYPASSRLS) не меняются. Дефолтные привилегии локальной PG-среды и облачного Supabase могут различаться — проверять в целевой среде.

## 1. Предмет: ровно 10 политик

| # | Таблица (домен) | Политика | Файл:строка | Текущее выражение |
|---|---|---|---|---|
| 1 | `domain_events` | `domain_events_select` | 0053_ops_center.sql:37 | `FOR SELECT TO authenticated USING (true)` |
| 2 | `ops_tasks` | `ops_tasks_select` | 0053_ops_center.sql:79 | `FOR SELECT TO authenticated USING (true)` |
| 3 | `purchase_drafts` | `purchase_drafts_select` | 0053_ops_center.sql:118 | `FOR SELECT TO authenticated USING (true)` |
| 4 | `purchase_draft_items` | `purchase_draft_items_select` | 0053_ops_center.sql:125 | `FOR SELECT TO authenticated USING (true)` |
| 5 | `recipe_ingredients` | `recipe_ingredients_select` | 0053_ops_center.sql:152 | `FOR SELECT TO authenticated USING (true)` |
| 6 | `confectioner_capacity` | `confectioner_capacity_select` | 0054_order_lifecycle_capacity.sql:53 | `FOR SELECT TO authenticated USING (true)` |
| 7 | `capacity_reservations` | `capacity_reservations_select` | 0054_order_lifecycle_capacity.sql:110 | `FOR SELECT TO authenticated USING (true)` |
| 8 | `order_production` | `order_production_select` | 0054_order_lifecycle_capacity.sql:149 | `FOR SELECT TO authenticated USING (true)` |
| 9 | `order_production_checklist` | `order_production_checklist_select` | 0054_order_lifecycle_capacity.sql:178 | `FOR SELECT TO authenticated USING (true)` |
| 10 | `order_media` | `order_media_select` | 0054_order_lifecycle_capacity.sql:216 | `FOR SELECT TO authenticated USING (true)` |

## 2. Аудит клиентских чтений — риск сужения минимален

Все 10 таблиц читаются **только серверным кодом** через `getPool()` (postgres-пул, BYPASSRLS)
или `supabaseAdmin` (`service_role`); браузерный клиент (supabase browser / use-*.ts хуки)
прямых чтений не имеет — проверено grep'ом `.from(...)`/`public.<таблица>` по `src/`:

| Таблица | Читает в коде (file:line) | Путь |
|---|---|---|
| `domain_events` | запись `src/lib/ops/events.ts:43`; чтение — только серверные API (timeline заказа; `order-timeline-events.tsx:7`, `order-workspace-dialog.tsx:9`) | getPool() |
| `ops_tasks` | `src/app/api/ops/tasks/route.ts:90,100`; `src/app/api/ops/confectioner-today/route.ts:109,121`; материализация `src/lib/ops/rules.ts:164-320`; app-фильтр видимости `src/lib/ops/visibility.ts:25-44` | getPool() |
| `purchase_drafts` | `src/lib/ops/rules.ts:488,497`; `src/lib/ops/acceptance.ts:248`; `confectioner-today/route.ts:209` | getPool() |
| `purchase_draft_items` | `src/lib/ops/rules.ts:516,523`; `src/lib/ops/acceptance.ts:249`; `confectioner-today/route.ts:210` | getPool() |
| `recipe_ingredients` | `src/lib/ops/breakdown.ts:223` (getPool); `src/lib/recipes/recipe-content.ts:306`; `src/app/api/recipes/[id]/route.ts:557,602,609`; `src/app/api/recipes/route.ts:297`; `marketplace/route.ts:397` | getPool()/supabaseAdmin |
| `confectioner_capacity` | `src/lib/ops/capacity.ts:150` | getPool() |
| `capacity_reservations` | `src/lib/ops/capacity.ts:215,328,369,395`; `src/lib/ops/risk-engine.ts:106` | getPool() |
| `order_production` | `src/lib/ops/risk-engine.ts:102,217`; `src/lib/ops/rules.ts:794`; `src/lib/ops/production.ts:64` | getPool() |
| `order_production_checklist` | `src/lib/ops/production.ts:50,90,110`; `src/lib/ops/risk-engine.ts:113`; `src/lib/ops/lifecycle.ts:609` | getPool() |
| `order_media` | `src/lib/ops/order-media.ts:131,175,211,240`; `src/lib/ops/risk-engine.ts:118`; `src/lib/ops/lifecycle.ts:623` | getPool() |

## 3. Предлагаемые условия («участники + админы»)

Админ-ветка — существующий хелпер `public.is_platform_admin()` (0074:33-53: SECURITY DEFINER,
STABLE, `SET search_path = public`; рекурсии 42P17 нет). Владелец заказа — `orders.user_id`
(покупатель) / `orders.confectioner_id` (0002:179,182-183); владелец черновика — `owner_id`
(0053:88); владелец рецепта — `recipes.author_id` (0010:108).

| Таблица | Предлагаемое `USING` (только FOR SELECT, TO authenticated) |
|---|---|
| `domain_events` | `public.is_platform_admin() OR actor_id = auth.uid() OR (entity_type = 'order' AND EXISTS (SELECT 1 FROM orders o WHERE o.id::text = entity_id AND (o.user_id = auth.uid() OR o.confectioner_id = auth.uid())))` |
| `ops_tasks` | `assignee_id = auth.uid() OR assignee_role IS NULL OR public.is_platform_admin()` (зеркало `visibility.ts:25-44`; MODERATOR-ветку `assignee_role IN ('ADMIN','MODERATOR')` при желании добавить после Q-7) |
| `purchase_drafts` | `owner_id = auth.uid() OR public.is_platform_admin()` |
| `purchase_draft_items` | `public.is_platform_admin() OR EXISTS (SELECT 1 FROM purchase_drafts d WHERE d.id = draft_id AND d.owner_id = auth.uid())` |
| `recipe_ingredients` | `public.is_platform_admin() OR EXISTS (SELECT 1 FROM recipes r WHERE r.id = recipe_id AND r.author_id = auth.uid())` |
| `confectioner_capacity` | `user_id = auth.uid() OR public.is_platform_admin()` |
| `capacity_reservations` | `confectioner_id = auth.uid() OR public.is_platform_admin() OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR o.confectioner_id = auth.uid()))` |
| `order_production` | как `capacity_reservations` (участие в заказе по `order_id` + админы) |
| `order_production_checklist` | как `capacity_reservations` (по `order_id` + админы) |
| `order_media` | как `capacity_reservations` (по `order_id`; доп. `uploaded_by = auth.uid()` опционально) |

SQL-скелет миграции (паттерн для каждой из 10, гвард по `qual = 'true'` → rerun-safe
и защита от «молчаливого повторного сужения» после отката):

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE tablename = 'ops_tasks' AND policyname = 'ops_tasks_select'
               AND qual = 'true') THEN
    DROP POLICY ops_tasks_select ON public.ops_tasks;
    CREATE POLICY ops_tasks_select ON public.ops_tasks
      FOR SELECT TO authenticated
      USING (assignee_id = auth.uid() OR assignee_role IS NULL
             OR public.is_platform_admin());
  END IF;
END $$;
```

## 4. Риски при сужении (минимальны)

- Серверные пути (`getPool()`/`supabaseAdmin`) — `service_role`/BYPASSRLS: поведение API не меняется ни в одном маршруте (§2).
- Единственное видимое изменение — прямые PostgREST-запросы под `authenticated` начнут возвращать пустые/отфильтрованные наборы; это целевое поведение SEC-1 (RECIPE_01:1524).
- Подзапросы в `USING` добавляют латентность на клиентских SELECT-путях; клиентских путей нет (§2) → латентность не наблюдаема; GRANT-конфигурация не меняется.
- Запись в эти таблицы клиентом и так отсутствует (INSERT/UPDATE/DELETE только service_role); сужение SELECT-политик запись не затрагивает.

## 5. План миграции 0073

- Номер **0073 зарезервирован** за SECURITY-RECIPE-01 (0074:26-27; 0077:184) — имя файла `0073_*.sql` больше никем не занято.
- Позиция — конец ledger (после текущего HEAD); идемпотентность — DO-гварды `pg_policies.qual = 'true'` (§3); rerun — no-op.
- Хелпер `is_platform_admin()` уже в ledger (0074:33-53) — новых функций/объектов не требуется.
- Верификация: негатив-тесты под реальными ролями — прямой PostgREST SELECT под `authenticated` к 10 таблицам → пусто/фильтровано; под `service_role` → без изменений; rerun 0073 чистый.
- Окно — до RECIPE-05 (RECIPE_01:1559); в 0077 (RELEASE-03) сужение не выполнялось (0077:19-20).

## 6. Откат

```sql
-- на каждую из 10 политик (пример ops_tasks):
DROP POLICY IF EXISTS ops_tasks_select ON public.ops_tasks;
CREATE POLICY ops_tasks_select ON public.ops_tasks
  FOR SELECT TO authenticated USING (true);
-- откат = возврат к состоянию 0053/0054 (идемпотентно, forward-only не нарушается);
-- хелпер public.is_platform_admin() НЕ удалять — используется политиками
-- user_roles (0074:74-116) и, возможно, другими суженными политиками.
```

Кросс-ссылки: RECIPE_01 §K RB.18 (SECURITY-RECIPE-01 → миграции 0073 + SEC-3/SEC-5/SEC-9 вне RECIPE-02), 0074:26-27, 0077:19-20/184.
