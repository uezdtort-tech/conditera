-- ============================================================================
-- 0071_inventory_writeoff_idempotency_rls.sql — RECIPE-02 (Этап B, RB.17/RA.17.7)
--
-- Складская идемпотентность производственных партий + закрытие SEC-2:
--   1. inventory_write_offs: +batch_id (FK RESTRICT), +idempotency_key;
--   2. два частичных UNIQUE (RA.11.2): ровно одно списание на партию;
--      универсальный ключ повтора;
--   3. RPC apply_inventory_write_off_batch (РЕШ-7/RA.11.3):
--      SECURITY INVOKER + SET search_path (SEC-10), реестр-первым,
--      одна транзакция, полный откат при любой ошибке позиции;
--      GRANT EXECUTE — только service_role (REVOKE PUBLIC);
--   4. SEC-2: ENABLE RLS на inventory_movements / inventory_write_offs /
--      supplier_profiles (политики owner/ADMIN; мутации — только service/RPC;
--      supplier_profiles — по модели confectioners 0026, TEXT-модели сравниваются
--      только через auth.uid()::text — урок B1/0064:93).
--
-- Проверено по коду перед включением RLS: оба складских маршрута
-- (movements/write-off) работают исключительно через supabaseAdmin —
-- пользовательские сценарии не регрессируют (RB.16/SEC-2 компенсации).
--
-- Перенос данных: НЕТ (никаких начислений остатков — RB.17).
--
-- Идемпотентность: ADD COLUMN IF NOT EXISTS; UNIQUE — IF NOT EXISTS;
-- RPC — CREATE OR REPLACE; политики/триггеры — DO-гварды; FK — DO-гварда
-- pg_constraint. Повторный прогон файла — no-op.
-- ============================================================================

-- ============================================================================
-- 1. inventory_write_offs: колонки партии и идемпотентности (аддитивно)
-- ============================================================================
ALTER TABLE public.inventory_write_offs
  ADD COLUMN IF NOT EXISTS batch_id UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMENT ON COLUMN public.inventory_write_offs.batch_id IS
  'RECIPE-02: производственная партия списания; UNIQUE — ровно одно списание на партию (RA.11.2)';
COMMENT ON COLUMN public.inventory_write_offs.idempotency_key IS
  'RECIPE-02: универсальный ключ повтора (pb:{batch_id} / pb:{batch_id}:{attempt}); задаётся сервером, не клиентом (RA.11.2)';

-- FK RESTRICT — DO-гварда pg_constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_inventory_write_offs_batch'
       AND conrelid = 'public.inventory_write_offs'::regclass
  ) THEN
    ALTER TABLE public.inventory_write_offs
      ADD CONSTRAINT fk_inventory_write_offs_batch
      FOREIGN KEY (batch_id)
      REFERENCES public.recipe_production_batches (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Частичные UNIQUE (RA.11.2)
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_write_offs_batch
  ON public.inventory_write_offs (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_write_offs_idempotency
  ON public.inventory_write_offs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Усиление DELETE-политики партий (RB.16 «owner (до списания)»): 0070 создал
-- owner-only версию (колонка batch_id появилась только что); DROP + CREATE
-- под DO-гвардов — rerun-safe (повторный прогон: политика уже с гвардой → no-op)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'recipe_production_batches'
       AND policyname = 'recipe_production_batches_delete_own'
       AND qual NOT LIKE '%inventory_write_offs%'
  ) THEN
    DROP POLICY recipe_production_batches_delete_own ON public.recipe_production_batches;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'recipe_production_batches'
       AND policyname = 'recipe_production_batches_delete_own'
  ) THEN
    CREATE POLICY recipe_production_batches_delete_own ON public.recipe_production_batches
      FOR DELETE TO authenticated
      USING (
        owner_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.inventory_write_offs w
           WHERE w.batch_id = recipe_production_batches.id
        )
      );
  END IF;
END $$;

-- ============================================================================
-- 2. RPC apply_inventory_write_off_batch (РЕШ-7 / RA.11.3)
--    Порядок строго: (1) реестр-первым INSERT ON CONFLICT DO NOTHING;
--    (2) конфликт → сохранённый результат, движения НЕ применяются;
--    (3) иначе — FOR UPDATE / insufficient-guard / UPDATE quantity / INSERT
--    movement для каждой позиции; (4) любая ошибка → RAISE → полный откат.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.apply_inventory_write_off_batch(
  p_owner_id       uuid,
  p_items          jsonb,      -- [{item_id, quantity, unit?}]
  p_order_id       uuid DEFAULT NULL,
  p_batch_id       uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_signature      text DEFAULT NULL  -- sha256 отсортированного "item_id:qty"; вычисляет СЕРВЕР
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row       public.inventory_write_offs;
  v_existing  public.inventory_write_offs;
  v_elem      jsonb;
  v_item_id   uuid;
  v_qty       numeric;
  v_unit      text;
  v_inv       public.inventory_items;
  v_new_qty   numeric;
  v_movement  uuid;
  v_applied   jsonb := '[]'::jsonb;
BEGIN
  -- ── Валидация входа (никакого доверия клиенту; signature обязателен) ──
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION '[write_off_batch] p_owner_id обязателен';
  END IF;
  IF p_signature IS NULL OR btrim(p_signature) = '' THEN
    RAISE EXCEPTION '[write_off_batch] p_signature обязателен (sha256 отсортированного item_id:qty)';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '[write_off_batch] p_items — непустой массив [{item_id, quantity, unit?}]';
  END IF;
  IF p_order_id IS NULL AND p_batch_id IS NULL AND COALESCE(p_idempotency_key, '') = '' THEN
    RAISE EXCEPTION '[write_off_batch] требуется business-ключ: p_order_id, p_batch_id или p_idempotency_key';
  END IF;

  -- ── Шаг 1: РЕЕСТР-ПЕРВЫМ. ON CONFLICT DO WITHOUT target: конфликт ЛЮБОГО
  --    уникального ключа ((owner,order,signature) | batch_id | idempotency_key)
  --    означает повтор/гонку → replay. ──
  INSERT INTO public.inventory_write_offs
    (owner_id, order_id, batch_id, idempotency_key, signature, items, result)
  VALUES
    (p_owner_id, p_order_id, p_batch_id, NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
     p_signature, p_items, '{}'::jsonb)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_row;

  -- ── Шаг 2: конфликт → идемпотентный replay, движения НЕ применяются ──
  IF v_row.id IS NULL THEN
    SELECT * INTO v_existing
      FROM public.inventory_write_offs w
     WHERE (p_batch_id IS NOT NULL AND w.batch_id = p_batch_id)
        OR (p_batch_id IS NULL AND p_order_id IS NOT NULL
            AND w.owner_id = p_owner_id AND w.order_id = p_order_id
            AND w.signature = p_signature)
        OR (p_batch_id IS NULL AND p_order_id IS NULL
            AND NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NOT NULL
            AND w.idempotency_key = NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''))
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION '[write_off_batch] конфликт уникальности, но реестровая строка не найдена — проверьте ключи';
    END IF;

    RETURN jsonb_build_object(
      'idempotent', true,
      'write_off_id', v_existing.id,
      'result', COALESCE(v_existing.result, '{}'::jsonb)
    );
  END IF;

  -- ── Шаг 3: применение движений (семантика 0048: FOR UPDATE → guard →
  --    UPDATE quantity → INSERT movement). RAISE на любой ошибке позиции
  --    откатывает ВСЁ (включая реестровую строку шага 1). ──
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(btrim(COALESCE(v_elem->>'item_id', '')), '')::uuid;
    v_qty     := NULLIF(btrim(COALESCE(v_elem->>'quantity', '')), '')::numeric;
    v_unit    := NULLIF(btrim(COALESCE(v_elem->>'unit', '')), '');

    IF v_item_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '[write_off_batch] bad_item: %', v_elem::text;
    END IF;

    SELECT * INTO v_inv
      FROM public.inventory_items
     WHERE id = v_item_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[write_off_batch] not_found:%', v_item_id;
    END IF;

    IF v_inv.owner_id IS DISTINCT FROM p_owner_id THEN
      RAISE EXCEPTION '[write_off_batch] forbidden_item:%', v_item_id;
    END IF;

    IF v_unit IS NOT NULL AND v_inv.unit IS NOT NULL
       AND lower(v_inv.unit) <> lower(v_unit) THEN
      RAISE EXCEPTION '[write_off_batch] unit_mismatch:%', v_item_id;
    END IF;

    v_new_qty := COALESCE(v_inv.quantity, 0) - v_qty;
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION '[write_off_batch] insufficient:%', v_item_id;
    END IF;

    UPDATE public.inventory_items
       SET quantity = v_new_qty,
           updated_at = now()
     WHERE id = v_item_id;

    INSERT INTO public.inventory_movements
      (item_id, user_id, type, quantity, reason, order_id)
    VALUES
      (v_item_id, p_owner_id, 'OUT', v_qty,
       CASE WHEN p_batch_id IS NOT NULL THEN 'batch write-off' ELSE 'order write-off' END,
       p_order_id)
    RETURNING id INTO v_movement;

    v_applied := v_applied || jsonb_build_object(
      'item_id',     v_item_id,
      'movement_id', v_movement,
      'quantity',    v_qty,
      'new_qty',     v_new_qty
    );
  END LOOP;

  -- ── Шаг 4: успех — фиксируем результат в реестре и возвращаем ──
  UPDATE public.inventory_write_offs
     SET result = jsonb_build_object('applied', v_applied, 'applied_at', now())
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'idempotent', false,
    'write_off_id', v_row.id,
    'result', jsonb_build_object('applied', v_applied, 'applied_at', now())
  );
END;
$$;

COMMENT ON FUNCTION public.apply_inventory_write_off_batch(uuid, jsonb, uuid, uuid, text, text) IS
  'RECIPE-02/РЕШ-7: атомарное идемпотентное списание партии/заказа; реестр-первым; INVOKER + search_path (SEC-10)';

-- GRANT-дисциплина (SEC-10/RB.16): EXECUTE — только service_role
REVOKE ALL ON FUNCTION public.apply_inventory_write_off_batch(uuid, jsonb, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_inventory_write_off_batch(uuid, jsonb, uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.apply_inventory_write_off_batch(uuid, jsonb, uuid, uuid, text, text) FROM authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_inventory_write_off_batch(uuid, jsonb, uuid, uuid, text, text) TO service_role';
  END IF;
END $$;

-- ============================================================================
-- 3. SEC-2: ENABLE RLS на складских таблицах (политики owner/ADMIN;
--    мутаций authenticated нет — только service_role/RPC)
-- ============================================================================
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_write_offs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- inventory_movements: SELECT owner (через owner позиции) или админ
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'inventory_movements' AND policyname = 'inventory_movements_select_own') THEN
    CREATE POLICY inventory_movements_select_own ON public.inventory_movements
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.inventory_items i
           WHERE i.id = inventory_movements.item_id
             AND i.owner_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      );
  END IF;

  -- inventory_write_offs: SELECT owner или админ
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'inventory_write_offs' AND policyname = 'inventory_write_offs_select_own') THEN
    CREATE POLICY inventory_write_offs_select_own ON public.inventory_write_offs
      FOR SELECT TO authenticated
      USING (
        owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      );
  END IF;
  -- Намеренно нет INSERT/UPDATE/DELETE политик: мутации только через
  -- batch-RPC (service_role). Уровень API переписывается в RECIPE-03 (РЕШ-7).
END $$;

-- ============================================================================
-- 4. SEC-2: supplier_profiles RLS — по модели confectioners (0026)
--    TEXT-модель: сравнение только auth.uid()::text (урок B1: 0064:93)
-- ============================================================================
ALTER TABLE public.supplier_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Публичный SELECT только активных профилей (каталог поставщиков)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supplier_profiles' AND policyname = 'supplier_profiles_select_public') THEN
    CREATE POLICY supplier_profiles_select_public ON public.supplier_profiles
      FOR SELECT
      USING ("isActive" = true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supplier_profiles' AND policyname = 'supplier_profiles_select_admin') THEN
    CREATE POLICY supplier_profiles_select_admin ON public.supplier_profiles
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = auth.uid()
             AND ur.role IN ('ADMIN','SUPER_ADMIN')
             AND ur.is_active
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supplier_profiles' AND policyname = 'supplier_profiles_insert_own') THEN
    CREATE POLICY supplier_profiles_insert_own ON public.supplier_profiles
      FOR INSERT TO authenticated
      WITH CHECK ("userId" = auth.uid()::text);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supplier_profiles' AND policyname = 'supplier_profiles_update_own') THEN
    CREATE POLICY supplier_profiles_update_own ON public.supplier_profiles
      FOR UPDATE TO authenticated
      USING ("userId" = auth.uid()::text)
      WITH CHECK ("userId" = auth.uid()::text);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'supplier_profiles' AND policyname = 'supplier_profiles_delete_own') THEN
    CREATE POLICY supplier_profiles_delete_own ON public.supplier_profiles
      FOR DELETE TO authenticated
      USING ("userId" = auth.uid()::text);
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK PLAN (RA.17; выполняется вручную, порядок обратный применению)
-- ============================================================================
-- DROP POLICY IF EXISTS supplier_profiles_delete_own ON public.supplier_profiles;
-- DROP POLICY IF EXISTS supplier_profiles_update_own ON public.supplier_profiles;
-- DROP POLICY IF EXISTS supplier_profiles_insert_own ON public.supplier_profiles;
-- DROP POLICY IF EXISTS supplier_profiles_select_admin ON public.supplier_profiles;
-- DROP POLICY IF EXISTS supplier_profiles_select_public ON public.supplier_profiles;
-- ALTER TABLE public.supplier_profiles DISABLE ROW LEVEL SECURITY;  -- прежнее состояние (без RLS)
-- DROP POLICY IF EXISTS inventory_write_offs_select_own ON public.inventory_write_offs;
-- DROP POLICY IF EXISTS inventory_movements_select_own ON public.inventory_movements;
-- ALTER TABLE public.inventory_write_offs DISABLE ROW LEVEL SECURITY;  -- SEC-2 откат
-- ALTER TABLE public.inventory_movements DISABLE ROW LEVEL SECURITY;   -- SEC-2 откат
-- REVOKE ALL ON FUNCTION public.apply_inventory_write_off_batch(uuid, jsonb, uuid, uuid, text, text) FROM service_role;
-- DROP FUNCTION IF EXISTS public.apply_inventory_write_off_batch(uuid, jsonb, uuid, uuid, text, text);
-- DROP INDEX IF EXISTS uq_inventory_write_offs_idempotency;
-- DROP INDEX IF EXISTS uq_inventory_write_offs_batch;
-- ALTER TABLE public.inventory_write_offs DROP CONSTRAINT IF EXISTS fk_inventory_write_offs_batch;
-- ALTER TABLE public.inventory_write_offs
--   DROP COLUMN IF EXISTS idempotency_key,
--   DROP COLUMN IF EXISTS batch_id;
