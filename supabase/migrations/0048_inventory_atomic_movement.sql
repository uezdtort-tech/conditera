-- 0048_inventory_atomic_movement.sql
--
-- Атомарное применение движения склада (race-safe).
--
-- Проблема (production-audit @ release/production-audit):
--   src/lib/inventory.ts applyInventoryMovement() делала read-check-write:
--     1) SELECT quantity           (старое значение)
--     2) проверка "OUT: current - q >= 0"
--     3) UPDATE quantity = newQty  (безусловный)
--   Два параллельных OUT (остаток 1.0, два списания по 0.8) оба проходили
--   проверку → отрицательный остаток / lost update. Дополнительно insert
--   журнала и update остатка не были транзакционными (документированный
--   компромисс в шапке inventory.ts).
--
-- Решение: одна SQL-функция = одна неявная транзакция:
--   SELECT ... FOR UPDATE → guard "OUT < 0" → UPDATE остатка → INSERT журнала.
-- Параллельные вызовы сериализуются блокировкой строки inventory_items,
-- отрицательный остаток невозможен, журнал и остаток согласованы.
--
-- Семантика полностью повторяет src/lib/inventory.ts:
--   IN     : new_qty = current + q
--   OUT    : new_qty = current - q; new_qty < 0 → {ok:false, code:'insufficient'}
--   ADJUST : new_qty = q (абсолютная установка, q > 0)

CREATE OR REPLACE FUNCTION public.apply_inventory_movement_atomic(
  p_item_id uuid,
  p_type text,
  p_quantity numeric,
  p_actor uuid,
  p_reason text DEFAULT NULL,
  p_order_id uuid DEFAULT NULL
)
RETURNS TABLE (
  ok boolean,
  code text,
  available numeric,
  new_qty numeric,
  movement jsonb,
  item jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.inventory_items;
  v_current numeric;
  v_new_qty numeric;
  v_movement public.inventory_movements;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('IN', 'OUT', 'ADJUST') THEN
    RETURN QUERY SELECT false, 'bad_type'::text, NULL::numeric, NULL::numeric, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN QUERY SELECT false, 'bad_quantity'::text, NULL::numeric, NULL::numeric, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  -- Блокируем строку позиции: параллельные движения сериализуются здесь
  SELECT * INTO v_row
  FROM public.inventory_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::text, NULL::numeric, NULL::numeric, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  v_current := COALESCE(v_row.quantity, 0);

  IF p_type = 'IN' THEN
    v_new_qty := v_current + p_quantity;
  ELSIF p_type = 'OUT' THEN
    v_new_qty := v_current - p_quantity;
    IF v_new_qty < 0 THEN
      RETURN QUERY SELECT false, 'insufficient'::text, v_current, NULL::numeric, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
  ELSE -- ADJUST
    v_new_qty := p_quantity;
  END IF;

  UPDATE public.inventory_items
  SET quantity = v_new_qty,
      updated_at = now()
  WHERE id = p_item_id
  RETURNING * INTO v_row;

  INSERT INTO public.inventory_movements (item_id, user_id, type, quantity, reason, order_id)
  VALUES (p_item_id, p_actor, p_type, p_quantity, NULLIF(trim(p_reason), ''), p_order_id)
  RETURNING * INTO v_movement;

  RETURN QUERY SELECT true, 'applied'::text, v_current, v_new_qty, to_jsonb(v_movement), to_jsonb(v_row);
END;
$$;
