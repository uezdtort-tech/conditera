-- ============================================================================
-- 0077_release_security_closures.sql — RELEASE-03 §3
--
-- Закрытие ПРЯМЫХ write-path на уровне БД (GRANT-уровень), дополняет RLS.
--
-- Инварианты, которые защищает эта миграция:
--   • Склад: quantity меняется ТОЛЬКО атомарным RPC (0048/0071) с записью в
--     журнал inventory_movements. Прямой UPDATE/INSERT inventory_items от
--     клиента запрещён (дашборд читает PostgREST'ом — SELECT сохранён).
--   • Журнал: stock_movements (legacy) / inventory_movements (0046) —
--     append-only, фальсификация клиентом запрещена.
--   • Entitlement: recipe_purchases пишется ТОЛЬКО серверным webhook'ом
--     (RA.10, service_role); клиент — только чтение своих покупок.
--   • Модерация: статус/публикация рецепта меняются только серверными API
--     (service_role через supabaseAdmin), не клиентом.
--
-- РЕГИОН ИЗМЕНЕНИЙ: только REVOKE/GRANT (+ defense-in-depth CHECK на
-- неотрицательный остаток), БЕЗ триггеров и БЕЗ RLS-политик. Сужение политик
-- 0053/0054 (10 политик USING(true)) — отдельное решение владельца Q-7,
-- миграция 0073 (зарезервирована за SECURITY-RECIPE-01) — здесь не затрагивается.
--
-- Аудит клиентских записей (RELEASE-03 §3, ШАГ 1): через браузерный клиент
-- (src/lib/supabase/browser.ts + use-*.ts хуки) НЕТ ни одной записи в
-- recipes / recipe_marketplace / recipe_purchases / inventory_items /
-- stock_movements — только SELECT (recipe-developer-dashboard.tsx:97-127,
-- supabase-auth-sync.tsx:40). Все серверные записи в эти таблицы идут через
-- supabaseAdmin (service_role): src/app/api/recipes/**, src/app/api/inventory/**,
-- src/lib/recipes/**, src/lib/inventory.ts. Поэтому для recipes /
-- recipe_marketplace применяется ПОЛНЫЙ REVOKE записи (column-подход не нужен).
--
-- Реран-безопасность: REVOKE/GRANT идемпотентны по природе; CHECK добавляется
-- только через DO-гварду pg_constraint; GRANT service_role — под гвардом
-- pg_roles (дисциплина 0071:251-258). Повторный прогон файла — no-op.
-- Применение: psql / Supabase SQL-editor; harness применяет после ревью.
--
-- ROLLBACK PLAN (вручную, при необходимости):
--   GRANT INSERT, UPDATE, DELETE ON public.inventory_items TO anon, authenticated;
--   GRANT INSERT, UPDATE, DELETE ON public.stock_movements TO anon, authenticated;
--   GRANT INSERT, UPDATE, DELETE ON public.recipe_purchases TO anon, authenticated;
--   GRANT INSERT, UPDATE, DELETE ON public.recipes TO anon, authenticated;
--   GRANT INSERT, UPDATE, DELETE ON public.recipe_marketplace TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.apply_inventory_movement_atomic(uuid, text, numeric, uuid, text, uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.add_bonus_balance(text, integer) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.deduct_bonus_balance(text, integer) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.revenue_today() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.revenue_month() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.sum_succeeded_payments(timestamptz, timestamptz) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.auto_assign_confectioner(uuid, text) TO PUBLIC;
--   ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS inventory_items_quantity_nonnegative;
--   (возврат к состоянию до 0077; 0025 выдавал I/U/D на recipe_marketplace /
--   recipe_purchases всем ролям, SELECT при REVOKE не затрагивается)
-- ============================================================================

-- ============================================================================
-- 1) Склад: клиенту — только чтение позиций (дашборд читает PostgREST'ом).
--    Серверные маршруты (src/app/api/inventory/**) и RPC работают от
--    service_role и не зависят от этих GRANT (аудит: клиентских записей нет).
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE ON public.inventory_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_items FROM authenticated;

-- legacy-журнал: append-only, фальсификация запрещена
-- (клиентских обращений нет вовсе; сервер — только service_role: cleanup.ts:412)
REVOKE INSERT, UPDATE, DELETE ON public.stock_movements FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.stock_movements FROM authenticated;

-- ============================================================================
-- 2) Складской RPC: EXECUTE только service_role
--    (дисциплина 0071:251-258; единственный атомарный путь изменения
--    inventory_items.quantity — RELEASE-03 §3 «единственный атомарный RPC»).
--    Сигнатура по 0048:25-32 (типы по позиции; DEFAULT-аргументы опущены).
--    Вызовы в src/ только серверные: src/lib/inventory.ts:129 (supabaseAdmin).
-- ============================================================================
REVOKE ALL ON FUNCTION public.apply_inventory_movement_atomic(uuid, text, numeric, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_inventory_movement_atomic(uuid, text, numeric, uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.apply_inventory_movement_atomic(uuid, text, numeric, uuid, text, uuid) FROM authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_inventory_movement_atomic(uuid, text, numeric, uuid, text, uuid) TO service_role';
  END IF;
END $$;

-- ============================================================================
-- 3) Entitlement: покупка создаётся ТОЛЬКО webhook'ом (RA.10, service_role).
--    Клиент читает свои покупки (SELECT сохранён: recipe-developer-dashboard
--    .tsx:122-127); сервер — service_role (src/app/api/recipes/purchases,
--    src/app/api/payment/webhook). 0025:15 выдавал I/U/D всем ролям — закрываем.
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE ON public.recipe_purchases FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.recipe_purchases FROM authenticated;

-- ============================================================================
-- 4) recipes / recipe_marketplace: полный REVOKE записи.
--    Аудит (ШАГ 1): клиентских записей НЕТ (RecipeAuthorManager и оффер-флоу
--    идут через csrfFetch /api/recipes* → service_role; браузер только SELECT
--    в recipe-developer-dashboard). Статусы/публикация — только серверные API;
--    counter-колонки (views/likes) — только сервер. SELECT не затронут.
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE ON public.recipes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.recipes FROM authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.recipe_marketplace FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.recipe_marketplace FROM authenticated;

-- ============================================================================
-- 5) Защита от отрицательного остатка (defense-in-depth, БЕЗ триггера):
--    CHECK-гвард на inventory_items.quantity. Атомарный RPC 0048 уже guard'ит
--    OUT; CHECK страхует ADJUST/прямой UPDATE от service_role-багов и ручных
--    правок. DO-гварда pg_constraint + проверка данных перед навешиванием.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_items_quantity_nonnegative'
  ) THEN
    NULL; -- уже есть (rerun)
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.inventory_items WHERE quantity IS NOT NULL AND quantity < 0
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_quantity_nonnegative
      CHECK (quantity IS NULL OR quantity >= 0);
  ELSE
    RAISE WARNING '0077: найдены отрицательные quantity — CHECK не добавлен, требуется чистка данных';
  END IF;
END $$;

-- ============================================================================
-- 6) RPC финансов/назначений: EXECUTE только service_role.
--    Аудит вызовов rpc() по src/: перечисленные функции вызываются ТОЛЬКО из
--    серверного кода через supabaseAdmin (loyalty.ts:113/269; admin/dashboard
--    .route.ts:109-110) либо не вызываются вовсе; клиентских вызовов (use-*)
--    НЕТ → закрываем (дисциплина 0036:65-86, 0071:250-259).
--    add/deduct_bonus_balance уже закрыты 0036 — re-assert идемпотентен и
--    страхует на случай пересоздания функций (CREATE OR REPLACE ACL
--    сохраняет, но явный re-assert делает 0077 самодостаточным).
--    Сигнатуры по 0013:432-529/0045:11-79 (text, integer), 0011:290-293
--    (uuid, text), 0013:432-435 (timestamptz, timestamptz) — типы по позиции.
-- ============================================================================
REVOKE ALL ON FUNCTION public.add_bonus_balance(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_bonus_balance(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.add_bonus_balance(text, integer) FROM authenticated;

REVOKE ALL ON FUNCTION public.deduct_bonus_balance(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deduct_bonus_balance(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.deduct_bonus_balance(text, integer) FROM authenticated;

REVOKE ALL ON FUNCTION public.revenue_today() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revenue_today() FROM anon;
REVOKE ALL ON FUNCTION public.revenue_today() FROM authenticated;

REVOKE ALL ON FUNCTION public.revenue_month() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revenue_month() FROM anon;
REVOKE ALL ON FUNCTION public.revenue_month() FROM authenticated;

REVOKE ALL ON FUNCTION public.sum_succeeded_payments(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sum_succeeded_payments(timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.sum_succeeded_payments(timestamptz, timestamptz) FROM authenticated;

REVOKE ALL ON FUNCTION public.auto_assign_confectioner(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_assign_confectioner(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.auto_assign_confectioner(uuid, text) FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.add_bonus_balance(text, integer) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.deduct_bonus_balance(text, integer) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.revenue_today() TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.revenue_month() TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sum_succeeded_payments(timestamptz, timestamptz) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.auto_assign_confectioner(uuid, text) TO service_role';
  END IF;
END $$;

-- НЕ закрыты (требуют решения владельца, самостоятельный enrichment-риск
-- отсутствует, но клиентская EXECUTE остаётся):
--   • search_products — клиентский вызов src/lib/supabase/use-marketplace.ts:298
--     (browser, FTS-поиск каталога) — трогать нельзя, сломает UI-поиск.

-- ============================================================================
-- ФИНАЛ: 0073 зарезервирована за SECURITY-RECIPE-01 (Q-7) — в этой миграции
-- не затрагивается (никаких RLS-политик, никакого сужения USING(true)).
-- ============================================================================
