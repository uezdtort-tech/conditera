-- 0100_fix_quote_confectioner_identity.sql
-- Quote rows use confectioners.id (text, e.g. "c0"); catalog products and
-- production orders use the confectioner's auth user UUID. Resolve explicitly.
BEGIN;

CREATE OR REPLACE FUNCTION public.accept_quote_and_create_order(
  p_quote_id UUID,
  p_customer_id UUID
)
RETURNS TABLE(order_id UUID, order_number TEXT, amount_rub NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.confectioner_quotes%ROWTYPE;
  v_request public.quote_requests%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_order_id UUID;
  v_order_number TEXT;
  v_quantity INTEGER;
  v_product_subtotal NUMERIC;
  v_delivery_cost NUMERIC;
  v_discount NUMERIC;
  v_total NUMERIC;
BEGIN
  IF p_quote_id IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'QUOTE_AND_CUSTOMER_REQUIRED';
  END IF;

  -- A retry returns the existing order for this customer and quote.
  SELECT o.id, o.number, o.total
    INTO v_order_id, v_order_number, v_total
    FROM public.orders AS o
   WHERE o.source_quote_id = p_quote_id
     AND o.user_id = p_customer_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_order_id, v_order_number, v_total;
    RETURN;
  END IF;

  SELECT * INTO v_quote
    FROM public.confectioner_quotes AS cq
   WHERE cq.id = p_quote_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;

  SELECT * INTO v_request
    FROM public.quote_requests AS qr
   WHERE qr.id = v_quote.quote_request_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_REQUEST_NOT_FOUND'; END IF;
  IF v_request.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'QUOTE_CUSTOMER_MISMATCH';
  END IF;

  -- A concurrent accept may have committed while this call waited on the
  -- quote/request row locks. Re-read after acquiring locks and return its order.
  SELECT o.id, o.number, o.total
    INTO v_order_id, v_order_number, v_total
    FROM public.orders AS o
   WHERE o.source_quote_id = p_quote_id
     AND o.user_id = p_customer_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_order_id, v_order_number, v_total;
    RETURN;
  END IF;

  IF v_request.expires_at <= now()
     OR v_request.status IN ('expired', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'QUOTE_REQUEST_EXPIRED';
  END IF;
  IF v_quote.status <> 'pending' THEN RAISE EXCEPTION 'QUOTE_NOT_PENDING'; END IF;
  IF v_quote.production_product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCTION_RECIPE_NOT_SELECTED';
  END IF;

  -- confectioner_quotes.confectioner_id references confectioners.id (TEXT).
  -- products.confectioner_id and orders.confectioner_id store the auth user UUID.
  SELECT p.* INTO v_product
    FROM public.products AS p
    JOIN public.confectioners AS c
      ON c."userId" = p.confectioner_id::text
   WHERE p.id = v_quote.production_product_id
     AND c.id = v_quote.confectioner_id
     AND p.status = 'published';
  IF NOT FOUND OR v_product.recipe_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCTION_RECIPE_UNAVAILABLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.recipe_ingredients AS ri
     WHERE ri.recipe_id = v_product.recipe_id
  ) THEN
    RAISE EXCEPTION 'PRODUCTION_RECIPE_EMPTY';
  END IF;

  IF v_quote.total_price <= 0
     OR v_quote.subtotal < 0
     OR v_quote.delivery_cost < 0
     OR v_quote.discount_amount < 0
     OR v_quote.total_price <> v_quote.subtotal - v_quote.discount_amount
     OR v_quote.subtotal < v_quote.delivery_cost THEN
    RAISE EXCEPTION 'QUOTE_AMOUNT_INVALID';
  END IF;

  v_quantity := GREATEST(COALESCE(v_request.quantity, 1), 1);
  v_product_subtotal := (v_quote.subtotal - v_quote.delivery_cost)::numeric / 100;
  v_delivery_cost := v_quote.delivery_cost::numeric / 100;
  v_discount := v_quote.discount_amount::numeric / 100;
  v_total := v_quote.total_price::numeric / 100;
  v_order_number := 'UK-' || to_char(now(), 'YYYY') || '-' ||
    lpad((floor(random() * 1000000)::integer)::text, 6, '0');

  INSERT INTO public.orders (
    number, user_id, confectioner_id, subtotal, delivery_cost, discount, total,
    status, type, delivery_address, delivery_city, delivery_date, delivery_type,
    notes, payment_method, metadata, source_quote_id
  ) VALUES (
    v_order_number, p_customer_id, v_product.confectioner_id,
    v_product_subtotal, v_delivery_cost, v_discount, v_total,
    'PENDING', 'product',
    CASE WHEN COALESCE(v_request.delivery_type, 'delivery') = 'delivery'
      THEN v_request.address ELSE NULL END,
    v_request.city, v_request.delivery_date::date,
    COALESCE(v_request.delivery_type, 'delivery'),
    v_request.comment, 'yookassa',
    jsonb_build_object(
      'source', 'accepted_quote',
      'quote_request_id', v_request.id,
      'confectioner_quote_id', v_quote.id,
      'project_spec', COALESCE(v_request.project_spec, '{}'::jsonb)
    ),
    p_quote_id
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, product_title, unit_price, quantity, selected_attributes, total
  ) VALUES (
    v_order_id, v_product.id,
    'Индивидуальный заказ: ' || COALESCE(v_request.product_type_label, v_product.title),
    v_product_subtotal / v_quantity, v_quantity,
    jsonb_build_object(
      'project_spec', COALESCE(v_request.project_spec, '{}'::jsonb),
      'quote_request_id', v_request.id,
      'confectioner_quote_id', v_quote.id
    ),
    v_product_subtotal
  );

  UPDATE public.confectioner_quotes
     SET status = 'accepted', updated_at = now()
   WHERE id = p_quote_id;

  UPDATE public.confectioner_quotes
     SET status = 'rejected', updated_at = now()
   WHERE quote_request_id = v_request.id
     AND id <> p_quote_id
     AND status = 'pending';

  UPDATE public.quote_requests
     SET status = 'approved', updated_at = now()
   WHERE id = v_request.id;

  RETURN QUERY SELECT v_order_id, v_order_number, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_quote_and_create_order(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_quote_and_create_order(UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
