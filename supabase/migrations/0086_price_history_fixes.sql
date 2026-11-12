-- ============================================================================
-- 0086_price_history_fixes.sql — PR-6A2 / D2: честный отказ при same-instant
-- установке цены (forward-only, CREATE OR REPLACE — сигнатура 0083 не меняется).
--
-- Дефект (PR-6A, evidence): POST .../price с effective_from == effective_from
-- текущей открытой строки и ДРУГОЙ суммой → set_product_price закрывал
-- покрывающую строку «на её собственном старте» → нулевой интервал
-- [from,from) → CHECK product_price_history_range_check (SQLSTATE 23514) →
-- необработанный 500.
--
-- Решение (DECISION PR-6A2): до любых мутаций — если покрывающая строка
-- начинается ровно в p_effective_from, закрытие/вставку НЕ выполняем;
-- возвращаем явный отказ sameInstant (jsonb). Изменение с той же точки
-- времени скрыло бы сумму за уже зафиксированной строкой — честно отклоняем:
-- клиенту 409 PRICE_PERIOD_CONFLICT (маршрут маппит sameInstant);
-- альтернативы — более поздний effective_from или администраторская коррекция.
--
-- Замечания:
--   • Проверка стоит ПОСЛЕ benign no-op «сумма совпала» (тот же instant + та же
--     сумма → по-прежнему честный noChange:true, ничего не скрыто).
--   • Идемпотентный replay и валидации 0083 не тронуты; блокировка products
--     FOR UPDATE сериализует конкурентов как прежде.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_product_price(
  p_actor uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_amount integer,
  p_effective_from timestamptz,
  p_reason text,
  p_comment text DEFAULT NULL,
  p_source text DEFAULT 'confectioner_ui',
  p_cost_snapshot integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_actor_is_admin boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_owner uuid;
  v_cover public.product_price_history%ROWTYPE;
  v_existing public.product_price_history%ROWTYPE;
  v_next_from timestamptz;
  v_effective_to timestamptz;
  v_previous_amount integer;
  v_new_id uuid;
  v_planned boolean;
BEGIN
  -- Валидации
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'amount must be >= 0 (RUB integer), got %', COALESCE(p_amount::text, 'NULL');
  END IF;
  IF p_reason NOT IN ('initial','ingredients','packaging','decor','logistics',
                      'fuel','electricity','labor','composition_change','other') THEN
    RAISE EXCEPTION 'invalid reason: %', COALESCE(p_reason, 'NULL');
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN (
      'confectioner_ui','admin_api','admin_correction','system','migration_seed') THEN
    RAISE EXCEPTION 'invalid source: %', p_source;
  END IF;
  IF p_effective_from <= '2000-01-01'::timestamptz THEN
    RAISE EXCEPTION 'effective_from must be after 2000-01-01';
  END IF;

  -- Блокировка строки товара: сериализует параллельные установки цены
  SELECT confectioner_id INTO v_owner
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product % not found', p_product_id;
  END IF;

  -- Доступ: владелец товара ИЛИ admin
  IF p_actor IS NULL OR (v_owner <> p_actor AND NOT COALESCE(p_actor_is_admin, false)) THEN
    RAISE EXCEPTION 'access denied: only product owner (confectioner_id) or admin may set price';
  END IF;

  -- Идемпотентный replay: до любых мутаций
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.product_price_history h
    WHERE h.product_id = p_product_id
      AND COALESCE(h.product_variant_id, v_zero) = COALESCE(p_variant_id, v_zero)
      AND h.idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', true,
        'versionId', v_existing.id,
        'previousAmount', NULL,
        'newAmount', v_existing.amount,
        'effectiveFrom', v_existing.effective_from,
        'effectiveTo', v_existing.effective_to,
        'planned', v_existing.effective_from > now()
      );
    END IF;
  END IF;

  -- Покрывающая строка [from, to) ∋ p_effective_from
  SELECT * INTO v_cover
  FROM public.product_price_history h
  WHERE h.product_id = p_product_id
    AND COALESCE(h.product_variant_id, v_zero) = COALESCE(p_variant_id, v_zero)
    AND h.effective_from <= p_effective_from
    AND (h.effective_to IS NULL OR h.effective_to > p_effective_from)
  ORDER BY h.effective_from DESC
  LIMIT 1;

  -- Ближайшая будущая версия (open или planned) — её effective_from станет нашей effective_to
  SELECT min(h.effective_from) INTO v_next_from
  FROM public.product_price_history h
  WHERE h.product_id = p_product_id
    AND COALESCE(h.product_variant_id, v_zero) = COALESCE(p_variant_id, v_zero)
    AND h.effective_from > p_effective_from;
  v_effective_to := v_next_from; -- NULL, если будущих нет

  -- Покрывающая строка с той же суммой: мутация бессмысленна — возвращаем её как no-op
  IF v_cover.id IS NOT NULL AND v_cover.amount = p_amount THEN
    RETURN jsonb_build_object(
      'idempotent', false,
      'noChange', true,
      'versionId', v_cover.id,
      'previousAmount', v_cover.amount,
      'newAmount', p_amount,
      'effectiveFrom', v_cover.effective_from,
      'effectiveTo', v_cover.effective_to,
      'planned', v_cover.effective_from > now()
    );
  END IF;

  -- D2 (PR-6A2): same-instant — покрывающая строка начинается ровно в
  -- p_effective_from. Закрытие «на собственном старте» дало бы нулевой
  -- интервал → 23514 (range_check). Не мутируем; явный честный отказ.
  IF v_cover.id IS NOT NULL AND v_cover.effective_from = p_effective_from THEN
    RETURN jsonb_build_object(
      'noChange', true,
      'sameInstant', true,
      'versionId', v_cover.id,
      'previousAmount', v_cover.amount,
      'newAmount', p_amount,
      'effectiveFrom', v_cover.effective_from,
      'effectiveTo', v_cover.effective_to,
      'planned', v_cover.effective_from > now(),
      'message', 'Изменение цены в тот же момент времени уже зафиксировано — используйте более позднее время или администраторскую коррекцию'
    );
  END IF;

  v_previous_amount := COALESCE(
    v_cover.amount,
    (SELECT price FROM public.products WHERE id = p_product_id)
  );

  -- Закрыть покрывающую версию на границе новой
  IF v_cover.id IS NOT NULL THEN
    UPDATE public.product_price_history
    SET effective_to = p_effective_from
    WHERE id = v_cover.id;
  END IF;

  -- Новая версия
  v_planned := p_effective_from > now();
  INSERT INTO public.product_price_history (
    product_id, product_variant_id, amount, currency, effective_from, effective_to,
    reason, comment, source, previous_version_id, cost_snapshot_rub,
    idempotency_key, created_by
  ) VALUES (
    p_product_id, p_variant_id, p_amount, 'RUB', p_effective_from, v_effective_to,
    p_reason, p_comment, COALESCE(p_source, 'confectioner_ui'), v_cover.id, p_cost_snapshot,
    p_idempotency_key, p_actor
  ) RETURNING id INTO v_new_id;

  -- Синхронизация products.price: только наступившая дата и только базовая цена
  IF NOT v_planned AND p_variant_id IS NULL THEN
    UPDATE public.products SET price = p_amount WHERE id = p_product_id;
  END IF;

  INSERT INTO public.product_price_audit (product_id, history_id, action, actor_id, details)
  VALUES (
    p_product_id, v_new_id,
    CASE WHEN v_planned THEN 'price_planned' ELSE 'price_set' END,
    p_actor,
    jsonb_build_object(
      'previousAmount', v_previous_amount,
      'newAmount', p_amount,
      'effectiveFrom', p_effective_from,
      'effectiveTo', v_effective_to,
      'variantId', p_variant_id,
      'source', COALESCE(p_source, 'confectioner_ui'),
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'versionId', v_new_id,
    'previousAmount', v_previous_amount,
    'newAmount', p_amount,
    'effectiveFrom', p_effective_from,
    'effectiveTo', v_effective_to,
    'planned', v_planned
  );
END;
$$;
