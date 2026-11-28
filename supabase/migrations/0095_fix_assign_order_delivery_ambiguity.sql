-- 0081_fix_assign_order_delivery_ambiguity.sql
-- RETURNS TABLE declares output variables named order_id and courier_id.
-- Qualify delivery columns to avoid PL/pgSQL variable/column ambiguity.
CREATE OR REPLACE FUNCTION public.assign_order_delivery(
  p_order_id UUID,
  p_courier_id UUID
)
RETURNS TABLE (
  delivery_id UUID,
  order_id UUID,
  courier_id UUID,
  created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_existing RECORD;
  v_delivery_id UUID;
BEGIN
  IF p_order_id IS NULL OR p_courier_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_AND_COURIER_REQUIRED';
  END IF;

  SELECT o.id, o.status, o.delivery_type, o.delivery_address, o.delivery_cost
    INTO v_order
    FROM public.orders AS o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_order.status <> 'IN_DELIVERY' THEN
    RAISE EXCEPTION 'ORDER_NOT_HANDED_OFF';
  END IF;
  IF COALESCE(v_order.delivery_type, 'delivery') NOT IN ('delivery') THEN
    RAISE EXCEPTION 'DELIVERY_NOT_REQUIRED';
  END IF;
  IF NULLIF(BTRIM(COALESCE(v_order.delivery_address, '')), '') IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_ADDRESS_REQUIRED';
  END IF;

  SELECT d.id, d.courier_id
    INTO v_existing
    FROM public.deliveries AS d
   WHERE d.order_id = p_order_id
     AND d.status IN ('assigned', 'picked_up', 'on_the_way')
   ORDER BY d.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.courier_id = p_courier_id THEN
      RETURN QUERY SELECT v_existing.id, p_order_id, p_courier_id, FALSE;
      RETURN;
    END IF;
    RAISE EXCEPTION 'ORDER_ALREADY_ASSIGNED';
  END IF;

  INSERT INTO public.deliveries (
    order_id, courier_id, status, address, cost, courier_earnings
  )
  VALUES (
    p_order_id, p_courier_id, 'assigned', v_order.delivery_address,
    COALESCE(v_order.delivery_cost, 0), 0
  )
  RETURNING id INTO v_delivery_id;

  RETURN QUERY SELECT v_delivery_id, p_order_id, p_courier_id, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_order_delivery(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_order_delivery(UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
