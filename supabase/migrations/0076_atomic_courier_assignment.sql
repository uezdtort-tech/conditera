-- 0076_atomic_courier_assignment.sql
-- Courier ownership lives in public.deliveries, not public.orders.
-- Serialize assignment on the order row so two couriers cannot claim it
-- concurrently; repeat assignment by the same courier is idempotent.

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
  v_delivery RECORD;
BEGIN
  IF p_order_id IS NULL OR p_courier_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_AND_COURIER_REQUIRED';
  END IF;

  SELECT id, status, delivery_type, delivery_address, delivery_cost
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
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

  SELECT id, courier_id
    INTO v_delivery
    FROM public.deliveries
   WHERE order_id = p_order_id
     AND status IN ('assigned', 'picked_up', 'on_the_way')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF v_delivery.courier_id = p_courier_id THEN
      RETURN QUERY SELECT v_delivery.id, p_order_id, p_courier_id, FALSE;
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
  RETURNING id INTO v_delivery.id;

  RETURN QUERY SELECT v_delivery.id, p_order_id, p_courier_id, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_order_delivery(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_order_delivery(UUID, UUID)
  TO service_role;
