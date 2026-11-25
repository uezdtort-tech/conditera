-- 0099_atomic_save_confectioner_quote.sql
-- Serialize offer creation/revision with customer acceptance and rejection.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_confectioner_quote(
  p_quote_request_id UUID,
  p_confectioner_id TEXT,
  p_production_product_id UUID,
  p_base_cost BIGINT,
  p_filling_cost BIGINT DEFAULT 0,
  p_coating_cost BIGINT DEFAULT 0,
  p_decoration_cost BIGINT DEFAULT 0,
  p_packaging_cost BIGINT DEFAULT 0,
  p_printing_cost BIGINT DEFAULT 0,
  p_storage_cost BIGINT DEFAULT 0,
  p_delivery_cost BIGINT DEFAULT 0,
  p_service_cost BIGINT DEFAULT 0,
  p_custom_design_cost BIGINT DEFAULT 0,
  p_discount_percent INTEGER DEFAULT 0,
  p_prep_days INTEGER DEFAULT 3,
  p_comment TEXT DEFAULT NULL,
  p_available_date DATE DEFAULT NULL,
  p_offered_packaging TEXT DEFAULT NULL,
  p_offered_delivery TEXT DEFAULT NULL
)
RETURNS SETOF public.confectioner_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.quote_requests%ROWTYPE;
  v_quote public.confectioner_quotes%ROWTYPE;
  v_subtotal BIGINT;
  v_discount BIGINT;
  v_total BIGINT;
BEGIN
  IF p_quote_request_id IS NULL OR p_confectioner_id IS NULL OR p_production_product_id IS NULL THEN
    RAISE EXCEPTION 'QUOTE_FIELDS_REQUIRED';
  END IF;
  IF p_base_cost < 0 OR p_filling_cost < 0 OR p_coating_cost < 0 OR
     p_decoration_cost < 0 OR p_packaging_cost < 0 OR p_printing_cost < 0 OR
     p_storage_cost < 0 OR p_delivery_cost < 0 OR p_service_cost < 0 OR
     p_custom_design_cost < 0 THEN
    RAISE EXCEPTION 'QUOTE_COST_INVALID';
  END IF;
  IF p_discount_percent < 0 OR p_discount_percent > 50 OR
     p_prep_days < 1 OR p_prep_days > 365 THEN
    RAISE EXCEPTION 'QUOTE_TERMS_INVALID';
  END IF;

  -- First lock an existing offer, then its request: same lock order as accept/reject.
  SELECT * INTO v_quote
    FROM public.confectioner_quotes
   WHERE quote_request_id = p_quote_request_id
     AND confectioner_id = p_confectioner_id
   FOR UPDATE;

  SELECT * INTO v_request
    FROM public.quote_requests
   WHERE id = p_quote_request_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_REQUEST_NOT_FOUND'; END IF;
  IF NOT (COALESCE(v_request.confectioner_ids, ARRAY[]::text[]) @> ARRAY[p_confectioner_id]) THEN
    RAISE EXCEPTION 'CONFECTIONER_NOT_INVITED';
  END IF;
  IF v_request.expires_at <= now() OR
     v_request.status IN ('approved', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'QUOTE_REQUEST_CLOSED';
  END IF;

  -- Re-read after the request lock: concurrent first responses are serialized here.
  SELECT * INTO v_quote
    FROM public.confectioner_quotes
   WHERE quote_request_id = p_quote_request_id
     AND confectioner_id = p_confectioner_id
   FOR UPDATE;
  IF FOUND AND v_quote.status = 'accepted' THEN
    RAISE EXCEPTION 'QUOTE_ALREADY_ACCEPTED';
  END IF;

  -- Каталог и recipe_ingredients обслуживаются основным PG18 в текущей
  -- двухкластерной конфигурации. Проверка товара/рецепта выполняется API
  -- через getPool(); эта RPC хранит только ссылку в Supabase PG15.
  v_subtotal := p_base_cost + p_filling_cost + p_coating_cost +
    p_decoration_cost + p_packaging_cost + p_printing_cost +
    p_storage_cost + p_delivery_cost + p_service_cost + p_custom_design_cost;
  IF v_subtotal <= 0 OR v_subtotal > 100000000 THEN
    RAISE EXCEPTION 'QUOTE_AMOUNT_INVALID';
  END IF;
  v_discount := round(v_subtotal::numeric * p_discount_percent / 100)::bigint;
  v_total := v_subtotal - v_discount;
  IF v_total <= 0 THEN RAISE EXCEPTION 'QUOTE_AMOUNT_INVALID'; END IF;

  IF v_quote.id IS NULL THEN
    INSERT INTO public.confectioner_quotes (
      quote_request_id, confectioner_id, base_cost, filling_cost, coating_cost,
      decoration_cost, packaging_cost, printing_cost, storage_cost, delivery_cost,
      service_cost, custom_design_cost, subtotal, discount_percent, discount_amount,
      total_price, prep_days, available_date, comment, offered_packaging,
      offered_delivery, production_product_id, status
    ) VALUES (
      p_quote_request_id, p_confectioner_id, p_base_cost, p_filling_cost, p_coating_cost,
      p_decoration_cost, p_packaging_cost, p_printing_cost, p_storage_cost, p_delivery_cost,
      p_service_cost, p_custom_design_cost, v_subtotal, p_discount_percent, v_discount,
      v_total, p_prep_days, p_available_date, NULLIF(LEFT(COALESCE(p_comment, ''), 2000), ''),
      p_offered_packaging, p_offered_delivery, p_production_product_id, 'pending'
    )
    RETURNING * INTO v_quote;
  ELSE
    IF v_quote.status NOT IN ('pending', 'rejected') THEN
      RAISE EXCEPTION 'QUOTE_ALREADY_PROCESSED';
    END IF;
    UPDATE public.confectioner_quotes
       SET base_cost = p_base_cost,
           filling_cost = p_filling_cost,
           coating_cost = p_coating_cost,
           decoration_cost = p_decoration_cost,
           packaging_cost = p_packaging_cost,
           printing_cost = p_printing_cost,
           storage_cost = p_storage_cost,
           delivery_cost = p_delivery_cost,
           service_cost = p_service_cost,
           custom_design_cost = p_custom_design_cost,
           subtotal = v_subtotal,
           discount_percent = p_discount_percent,
           discount_amount = v_discount,
           total_price = v_total,
           prep_days = p_prep_days,
           available_date = p_available_date,
           comment = NULLIF(LEFT(COALESCE(p_comment, ''), 2000), ''),
           offered_packaging = p_offered_packaging,
           offered_delivery = p_offered_delivery,
           production_product_id = p_production_product_id,
           status = 'pending',
           customer_comment = NULL,
           updated_at = now()
     WHERE id = v_quote.id
     RETURNING * INTO v_quote;
  END IF;

  UPDATE public.quote_requests
     SET status = 'quoted', updated_at = now()
   WHERE id = p_quote_request_id
     AND status IN ('sent', 'rejected');

  RETURN NEXT v_quote;
END;
$$;

REVOKE ALL ON FUNCTION public.save_confectioner_quote(
  UUID, TEXT, UUID, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT,
  BIGINT, BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, TEXT, DATE, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_confectioner_quote(
  UUID, TEXT, UUID, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT,
  BIGINT, BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, TEXT, DATE, TEXT, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
