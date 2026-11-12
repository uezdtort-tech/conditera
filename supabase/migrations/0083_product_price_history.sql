-- 0083_product_price_history.sql — PR-1A: эффективное-датированная история цен товаров.
--
-- Деньги: INTEGER РУБЛЕЙ (единство с products.price; identity-решение 0034 — копейки только
-- для service_products/refunds). currency = 'RUB'.
--
-- Модель: полузакрытые интервалы [effective_from, effective_to); effective_to IS NULL = открытая
-- (текущая) версия. Владелец товара — products.confectioner_id (проверено: 0002_marketplace.sql,
-- ownership-check в src/app/api/products/[id]/route.ts:292-300).
-- product_variants (0006) мёртв в live-коде, но модель поддерживает product_variant_id NULLable.
--
-- Forward-only, идемпотентно: повторный прогон не дублирует строки/объекты.

-- ============================================================================
-- 1. Таблицы
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.product_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_variant_id uuid NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount >= 0), -- РУБЛИ (int), согласовано с products.price
  currency TEXT NOT NULL DEFAULT 'RUB',
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,               -- полузакрытый [from, to); NULL = открытая
  reason TEXT NOT NULL CHECK (reason IN (
    'initial','ingredients','packaging','decor','logistics',
    'fuel','electricity','labor','composition_change','other')),
  comment TEXT NULL,
  source TEXT NOT NULL DEFAULT 'confectioner_ui' CHECK (source IN (
    'confectioner_ui','admin_api','admin_correction','system','migration_seed')),
  previous_version_id uuid NULL REFERENCES public.product_price_history(id),
  cost_snapshot_rub INTEGER NULL,              -- приблизительная себестоимость на момент изменения (approx, nullable)
  idempotency_key TEXT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_price_history_range_check
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Анти-даблсабмит: один и тот же idempotency_key в рамках (product, variant) — одна строка.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_price_history_idempotency
  ON public.product_price_history (
    product_id,
    COALESCE(product_variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_price_history_lookup
  ON public.product_price_history (product_id, effective_from DESC);

-- Аудит (append-only, стиль cms_audit из 0082). Без UPDATE/DELETE-путей; триггеры не обязательны,
-- т.к. запись ведётся только из миграций и функций ниже.
CREATE TABLE IF NOT EXISTS public.product_price_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NULL,
  history_id uuid NULL,
  action TEXT NOT NULL CHECK (action IN (
    'price_set','price_planned','admin_correction','catchup_sync','seed')),
  actor_id uuid NULL,
  details jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_price_audit_product
  ON public.product_price_audit (product_id, created_at DESC);

-- ============================================================================
-- 2. btree_gist: попытаться создать; недоступность — не фатальна (fallback ниже).
--    Выбранный путь фиксируем в product_price_audit.
-- ============================================================================

DO $$
DECLARE
  v_gist_ok boolean := false;
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS btree_gist';
    v_gist_ok := true;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '0083: btree_gist unavailable (%): exclusion constraint will be skipped, fallback partial UNIQUE index applies', SQLERRM;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_price_audit
    WHERE action = 'seed' AND details->>'migration' = '0083'
  ) THEN
    INSERT INTO public.product_price_audit (product_id, history_id, action, actor_id, details)
    VALUES (NULL, NULL, 'seed', NULL,
            jsonb_build_object('migration', '0083', 'btree_gist_available', v_gist_ok));
  END IF;
END $$;

-- Exclusion-контроль перекрытий интервалов на (product, COALESCE(variant)).
-- Если btree_gist недоступен — fallback: partial UNIQUE index гарантирует единственную
-- открытую строку (effective_to IS NULL) на (product, COALESCE(variant)).
-- Остаточный риск fallback-пути: Planned-версии могут перекрываться между собой
-- (две будущие строки с пересекающимися [from,to)) — обнаружится только логикой set_product_price.
DO $$
DECLARE
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_price_history_no_overlap'
      AND conrelid = 'public.product_price_history'::regclass
  ) THEN
    RAISE NOTICE '0083: exclusion constraint already present';
    RETURN;
  END IF;

  BEGIN
    EXECUTE format(
      'ALTER TABLE public.product_price_history
         ADD CONSTRAINT product_price_history_no_overlap
         EXCLUDE USING gist (
           product_id WITH =,
           COALESCE(product_variant_id, %L::uuid) WITH =,
           tstzrange(effective_from, effective_to) WITH &&
         )', v_zero);
    RAISE NOTICE '0083: exclusion constraint product_price_history_no_overlap created (btree_gist path)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '0083: exclusion constraint skipped (%), creating fallback one-open-row unique index', SQLERRM;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_product_price_history_one_open_row
      ON public.product_price_history (product_id, COALESCE(product_variant_id, v_zero))
      WHERE effective_to IS NULL;
  END;
END $$;

-- ============================================================================
-- 3. Функции
-- ============================================================================

-- Цена товара/варианта на момент времени. Покрывающая строка: from <= at < to (или to IS NULL).
-- Если истории нет — синтезируем строку из products.price (reason 'initial', version_id NULL),
-- чтобы legacy-товары всегда резолвились.
CREATE OR REPLACE FUNCTION public.get_product_price_at(
  p_product_id uuid,
  p_variant_id uuid DEFAULT NULL,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  version_id uuid,
  amount integer,
  currency text,
  effective_from timestamptz,
  effective_to timestamptz,
  reason text
)
LANGUAGE sql
STABLE
AS $$
  WITH zero AS (
    SELECT '00000000-0000-0000-0000-000000000000'::uuid AS id
  ),
  cov AS (
    SELECT h.id AS version_id, h.amount, h.currency, h.effective_from, h.effective_to, h.reason
    FROM public.product_price_history h, zero z
    WHERE h.product_id = p_product_id
      AND COALESCE(h.product_variant_id, z.id) = COALESCE(p_variant_id, z.id)
      AND h.effective_from <= p_at
      AND (h.effective_to IS NULL OR h.effective_to > p_at)
    ORDER BY h.effective_from DESC
    LIMIT 1
  )
  SELECT r.version_id, r.amount, r.currency, r.effective_from, r.effective_to, r.reason
  FROM (
    SELECT version_id, amount, currency, effective_from, effective_to, reason FROM cov
    UNION ALL
    SELECT NULL::uuid, p.price, COALESCE(p.currency, 'RUB'), p.created_at, NULL::timestamptz, 'initial'
    FROM public.products p
    WHERE p.id = p_product_id
      AND NOT EXISTS (SELECT 1 FROM cov)
  ) r
  ORDER BY (r.version_id IS NULL) ASC
  LIMIT 1;
$$;

-- Установка цены (одна транзакция): блокировка products FOR UPDATE сериализует конкуренту,
-- закрывает покрывающую версию, вставляет новую, при наступившей дате синхронизирует products.price
-- (только для базовой цены, variant IS NULL), пишет аудит.
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

-- Ленивый catch-up: для каждого товара, у которого текущая покрывающая строка истории
-- (базовая, начавшаяся <= now()) отличается от products.price — подтянуть products.price,
-- записать аудит 'catchup_sync'. Один SQL-стейтмент (атомарно), LATERAL-поиск покрывающей строки.
CREATE OR REPLACE FUNCTION public.sync_effective_product_prices()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH candidates AS (
    SELECT p.id AS product_id, h.id AS history_id, h.amount
    FROM public.products p
    JOIN LATERAL (
      SELECT h.id, h.amount
      FROM public.product_price_history h
      WHERE h.product_id = p.id
        AND h.product_variant_id IS NULL
        AND h.effective_from <= now()
        AND (h.effective_to IS NULL OR h.effective_to > now())
      ORDER BY h.effective_from DESC
      LIMIT 1
    ) h ON true
    WHERE p.price <> h.amount
    FOR UPDATE OF p
  ),
  updated AS (
    UPDATE public.products p
    SET price = c.amount
    FROM candidates c
    WHERE p.id = c.product_id
    RETURNING p.id AS product_id, c.history_id, c.amount
  )
  INSERT INTO public.product_price_audit (product_id, history_id, action, actor_id, details)
  SELECT u.product_id, u.history_id, 'catchup_sync', NULL,
         jsonb_build_object('newAmount', u.amount, 'syncedAt', now())
  FROM updated u;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================================
-- 4. Seed: начальная 'initial'-версия для каждого товара, у которого истории ещё нет.
-- ============================================================================

INSERT INTO public.product_price_history (
  product_id, product_variant_id, amount, currency,
  effective_from, effective_to, reason, source, cost_snapshot_rub, created_by
)
SELECT
  p.id, NULL, p.price, COALESCE(p.currency, 'RUB'),
  COALESCE(p.created_at, now()), NULL, 'initial', 'migration_seed', NULL, p.confectioner_id
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_price_history h
  WHERE h.product_id = p.id
    AND h.product_variant_id IS NULL
);
