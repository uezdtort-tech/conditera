-- ============================================================================
-- 0101_repair_order_writeoff_applied_ledger_accounting.sql — Z-v32 Пакет C-1
--
-- Две data-integrity правки с гарантией на уровне PostgreSQL (не приложения):
--
-- ZV31-002 — TOCTOU кумулятивного order-списания:
--   order-путь POST /api/inventory/write-off делал check-then-act РАЗДЕЛЬНЫМИ
--   запросами: (1) findExistingWriteOff — идемпотентность по (owner,order,
--   signature); (2) validateOrderWriteOffAgainstSnapshot — читает реестр
--   (уже списанное) и склад БЕЗ блокировок; (3) applyInventoryMovement на
--   каждую позицию (RPC 0048 — атомарен на ОДНУ позицию, но не на батч);
--   (4) INSERT в реестр. Два параллельных запроса по одному заказу оба
--   проходили шаги (1)-(2) до чужого коммита → двойное списание (одинаковая
--   сигнатура: движения применялись дважды, 23505 ловился ПОСЛЕ применения)
--   и/или кумулятивное превышение нормы snapshot (разные сигнатуры).
--
--   Решение: apply_order_write_off_atomic — ОДНА SQL-функция = одна
--   транзакция:
--     • SELECT orders ... FOR UPDATE — сериализация всех списаний заказа
--       (кумулятивная проверка выполняется ПОД блокировкой строки заказа);
--     • реестр-первым INSERT ... ON CONFLICT DO NOTHING (паттерн 0071) —
--       дедупликация одинаковой сигнатуры ДО применения движений (23505-гонка
--       больше не может привести к двойному применению);
--     • полная перепроверка против acceptance_snapshot В ТРАНЗАКЦИИ
--       (структура snapshot, покрытие order_items, нормативы с конвертацией
--       единиц, уже списанное из реестра) — паритет
--       src/lib/ops/write-off-validation.ts;
--     • блокировка складских позиций FOR UPDATE в отсортированном порядке
--       item_id (анти-deadlock), guard «остаток ≥ 0», UPDATE остатка,
--       INSERT движения — на каждую позицию (семантика 0048);
--     • частичный успех сохранён (applied+failed в реестре); ПОЛНЫЙ провал
--       (ни одной позиции) → RAISE → полный откат (реестр + движения);
--     • расхождение со snapshot без allow_overage → RAISE → откат (422).
--   Формат ответа маршрута не меняется; ошибки → существующие коды
--   (WRITE_OFF_SNAPSHOT_MISMATCH / SNAPSHOT_INVALID / 409 insufficient).
--
-- ZV31-003 — атомарный PATCH рецепта (корень + состав):
--   PATCH /api/recipes/[id] обновлял корень и детей ОТДЕЛЬНЫМИ запросами
--   (UPDATE recipes; DELETE recipe_ingredients; INSERT ...; substitutes;
--   steps; variants; sources) без общей транзакции — читатель (live-путь
--   breakdown/снапшот checkout) между DELETE и INSERT видел пустой/частичный
--   состав; компенсирующий откат был best-effort.
--
--   Решение: update_recipe_with_ingredients — ОДНА SQL-функция = одна
--   транзакция: блокировка строки корня FOR UPDATE → UPDATE корня (только
--   переданные ключи p_root) → полная замена переданных типов детей
--   (DELETE + INSERT; substitutes резолвятся по ingredient_position внутри
--   транзакции). Формат ответа PATCH не меняется.
--
-- Идемпотентность: только CREATE OR REPLACE FUNCTION; таблицы/колонки не
-- меняются. Повторный прогон файла — no-op. Перенос данных: НЕТ (RB.17).
-- GRANT-дисциплина (SEC-10): EXECUTE только service_role (REVOKE PUBLIC).
-- ============================================================================

-- ============================================================================
-- 1. Хелперы конвертации единиц (паритет src/lib/ops/units.ts, Z-v12)
--    UNKNOWN-единица или несовместимые измерения → NULL (fail-closed).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.inventory_unit_alias_info(
  p_raw text,
  OUT dim text,
  OUT factor numeric
)
RETURNS record
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT t.dim, t.factor
  FROM (VALUES
    -- масса (база — г)
    ('г',        1::numeric, 'масса'),
    ('гр',       1::numeric, 'масса'),
    ('gram',     1::numeric, 'масса'),
    ('грамм',    1::numeric, 'масса'),
    ('кг',    1000::numeric, 'масса'),
    ('kg',    1000::numeric, 'масса'),
    ('kilogram', 1000::numeric, 'масса'),
    ('килограмм', 1000::numeric, 'масса'),
    -- объём (база — мл)
    ('мл',       1::numeric, 'объём'),
    ('ml',       1::numeric, 'объём'),
    ('миллилитр', 1::numeric, 'объём'),
    ('milliliter', 1::numeric, 'объём'),
    ('л',     1000::numeric, 'объём'),
    ('l',     1000::numeric, 'объём'),
    ('liter', 1000::numeric, 'объём'),
    ('литр',  1000::numeric, 'объём'),
    -- штуки (база — шт; «дес» = ×10, урок приёмки Z-v12 сценарий E)
    ('шт',       1::numeric, 'шт'),
    ('штука',    1::numeric, 'шт'),
    ('штук',     1::numeric, 'шт'),
    ('pcs',      1::numeric, 'шт'),
    ('piece',    1::numeric, 'шт'),
    ('дес',     10::numeric, 'шт'),
    ('десяток', 10::numeric, 'шт'),
    ('десятки', 10::numeric, 'шт'),
    ('дюжина',  12::numeric, 'шт'),
    ('dozen',   12::numeric, 'шт'),
    ('dz',      12::numeric, 'шт')
  ) AS t(alias, factor, dim)
  WHERE t.alias = lower(btrim(COALESCE(p_raw, '')))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.inventory_unit_convert_qty(
  p_qty numeric,
  p_from text,
  p_to text
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT round((p_qty * f.factor / t.factor)::numeric, 6)
  FROM public.inventory_unit_alias_info(p_from) f
  JOIN public.inventory_unit_alias_info(p_to) t ON f.dim = t.dim
$$;

-- ============================================================================
-- 2. ZV31-002: атомарное кумулятивное order-списание (одна транзакция)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.apply_order_write_off_atomic(
  p_owner_id        uuid,      -- актор (user.id): владелец реестровой строки, user_id движений, владелец склада по умолчанию
  p_order_id        uuid,      -- бизнес-ключ дедупликации/серилизации (обязателен)
  p_items           jsonb,     -- [{item_id, quantity}] в единицах складских позиций
  p_signature       text,      -- sha256 отсортированных "item_id:quantity" (считает СЕРВЕР)
  p_reason          text DEFAULT NULL,
  p_allow_overage   boolean DEFAULT false,
  p_actor_is_admin  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row          public.inventory_write_offs;
  v_existing     public.inventory_write_offs;
  v_order        public.orders;
  v_order_found  boolean := false;
  v_owner        uuid;                       -- владелец склада (confectioner_id ?? actor)
  v_meta         jsonb;
  v_snap         jsonb;
  v_mode         text := 'legacy';
  v_pid          text;
  v_expected_map jsonb := '{}'::jsonb;       -- item_id -> ожидаемый норматив (единицы склада)
  v_mismatch_map jsonb := '{}'::jsonb;       -- item_id -> true (норма не переводима в единицу склада)
  v_already_map  jsonb := '{}'::jsonb;       -- item_id -> уже списанное (реестр, БЕТ текущей строки)
  v_deviations   jsonb := '[]'::jsonb;
  v_snap_item    jsonb;
  v_ing          jsonb;
  v_reg_items    jsonb;
  v_elem         jsonb;
  v_norm_inv_id  text;
  v_inv_id       uuid;
  v_inv_unit     text;
  v_contrib      numeric;
  v_exp          numeric;
  v_remaining    numeric;
  v_item_id      uuid;
  v_qty          numeric;
  v_inv          public.inventory_items;
  v_new_qty      numeric;
  v_movement     uuid;
  v_applied      jsonb := '[]'::jsonb;
  v_failed       jsonb := '[]'::jsonb;
  v_first_kind   text := NULL;
  v_first_available numeric := 0;
  v_reason       text;
  v_overage      boolean := false;
BEGIN
  -- ── Валидация входа (никакого доверия клиенту; signature/order_id обязательны) ──
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION '[order_write_off] p_owner_id обязателен';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION '[order_write_off] p_order_id обязателен (order-путь)';
  END IF;
  IF p_signature IS NULL OR btrim(p_signature) = '' THEN
    RAISE EXCEPTION '[order_write_off] p_signature обязателен (sha256 отсортированного item_id:qty)';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '[order_write_off] p_items — непустой массив [{item_id, quantity}]';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF v_elem->>'item_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR (v_elem->>'quantity')::numeric IS NULL
       OR COALESCE((v_elem->>'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION '[order_write_off] bad_item:%', COALESCE(v_elem::text, 'null');
    END IF;
  END LOOP;

  -- ── Шаг 1: блокировка строки заказа. Все списания ОДНОГО заказа
  --    сериализуются здесь: кумулятивная проверка (шаг 4) выполняется ПОД
  --    блокировкой → гонка «оба прошли проверку до чужого коммита» невозможна.
  --    Заказ не найден → легаси-поведение (валидации нет, паритет route). ──
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  v_order_found := FOUND;
  v_owner := COALESCE(v_order.confectioner_id, p_owner_id);

  -- ── Шаг 2: РЕЕСТР-ПЕРВЫМ (паттерн 0071). Конфликт ЛЮБОГО уникального ключа
  --    = повтор/гонка → replay сохранённого результата, движения НЕ пишутся.
  --    Дедупликация одинаковой сигнатуры теперь происходит ДО применения
  --    движений (раньше 23505 ловился ПОСЛЕ — двойное списание). ──
  INSERT INTO public.inventory_write_offs
    (owner_id, order_id, signature, items, result)
  VALUES
    (p_owner_id, p_order_id, p_signature, p_items, '{}'::jsonb)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_existing
      FROM public.inventory_write_offs w
     WHERE w.owner_id = p_owner_id
       AND w.order_id = p_order_id
       AND w.signature = p_signature
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION '[order_write_off] конфликт уникальности, но реестровая строка не найдена';
    END IF;
    RETURN jsonb_build_object(
      'idempotent', true,
      'duplicate', true,
      'order_id', p_order_id,
      'applied',  COALESCE(v_existing.result -> 'applied', '[]'::jsonb),
      'failed',   COALESCE(v_existing.result -> 'failed',  '[]'::jsonb)
    );
  END IF;

  -- ── Шаг 3: snapshot заказа (если есть) — структурная валидация, паритет
  --    readAcceptanceSnapshot (src/lib/ops/snapshot.ts): повреждённый —
  --    fail-closed RAISE snapshot_invalid. Отсутствие → легаси (mode legacy). ──
  IF v_order_found THEN
    IF v_order.metadata IS NOT NULL AND jsonb_typeof(v_order.metadata) = 'object' THEN
      v_meta := v_order.metadata;
    END IF;

    IF v_meta IS NOT NULL AND (v_meta -> 'acceptance_snapshot') IS NOT NULL THEN
      v_snap := v_meta -> 'acceptance_snapshot';

      IF jsonb_typeof(v_snap) <> 'object' THEN
        RAISE EXCEPTION '[order_write_off] snapshot_invalid:malformed';
      END IF;
      IF COALESCE((v_snap ->> 'schema_version')::int, -1) <> 1 THEN
        RAISE EXCEPTION '[order_write_off] snapshot_invalid:unknown_schema_version';
      END IF;
      IF COALESCE(btrim(COALESCE(v_snap ->> 'snapshot_id', '')), '') = ''
         OR COALESCE(btrim(COALESCE(v_snap ->> 'created_at', '')), '') = ''
         OR COALESCE(btrim(COALESCE(v_snap ->> 'source', '')), '') = ''
         OR v_snap -> 'items' IS NULL
         OR jsonb_typeof(v_snap -> 'items') <> 'array' THEN
        RAISE EXCEPTION '[order_write_off] snapshot_invalid:malformed';
      END IF;
      IF jsonb_array_length(v_snap -> 'items') = 0 THEN
        RAISE EXCEPTION '[order_write_off] snapshot_invalid:empty_items';
      END IF;

      FOR v_snap_item IN SELECT * FROM jsonb_array_elements(v_snap -> 'items') LOOP
        IF v_snap_item->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR jsonb_typeof(v_snap_item -> 'ingredients') <> 'array'
           OR COALESCE((v_snap_item ->> 'quantity')::numeric, 0) <= 0
           OR (v_snap_item ->> 'quantity')::numeric <> floor(COALESCE((v_snap_item ->> 'quantity')::numeric, 0)) THEN
          RAISE EXCEPTION '[order_write_off] snapshot_invalid:bad_item';
        END IF;
        FOR v_ing IN SELECT * FROM jsonb_array_elements(v_snap_item -> 'ingredients') LOOP
          IF COALESCE(btrim(COALESCE(v_ing ->> 'name', '')), '') = ''
             OR length(btrim(v_ing ->> 'name')) > 200
             OR COALESCE((v_ing ->> 'qty')::numeric, 0) <= 0
             OR COALESCE(btrim(COALESCE(v_ing ->> 'unit', '')), '') = ''
             OR (v_ing ->> 'inventory_item_id' IS NOT NULL
                 AND v_ing ->> 'inventory_item_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
            RAISE EXCEPTION '[order_write_off] snapshot_invalid:bad_ingredient';
          END IF;
        END LOOP;
      END LOOP;
      v_mode := 'snapshot';

      -- Покрытие: snapshot принадлежит ЭТОМУ заказу (товары и количества),
      -- паритет validateSnapshotCoversOrder. Позиции order_items с
      -- product_id NULL не проверяются.
      IF (
        SELECT count(DISTINCT item->>'product_id')
          FROM jsonb_array_elements(v_snap -> 'items') item
      ) <> (
        SELECT count(DISTINCT product_id::text)
          FROM public.order_items
         WHERE order_id = p_order_id AND product_id IS NOT NULL
      ) THEN
        RAISE EXCEPTION '[order_write_off] snapshot_invalid:product_set_mismatch';
      END IF;
      FOR v_pid IN
        SELECT item->>'product_id'
          FROM jsonb_array_elements(v_snap -> 'items') item
         GROUP BY item->>'product_id'
      LOOP
        IF (
          SELECT COALESCE(SUM((item->>'quantity')::numeric), 0)
            FROM jsonb_array_elements(v_snap -> 'items') item
           WHERE item->>'product_id' = v_pid
        ) <> (
          SELECT COALESCE(SUM(oi.quantity), 0)
            FROM public.order_items oi
           WHERE oi.order_id = p_order_id AND oi.product_id::text = v_pid
        ) THEN
          RAISE EXCEPTION '[order_write_off] snapshot_invalid:quantity_mismatch:%', v_pid;
        END IF;
      END LOOP;

      -- ── Шаг 4: ожидаемый норматив по позициям склада (единицы склада),
      --    паритет write-off-validation.ts §4: Σ (норма × количество товара),
      --    конвертация norm.unit → inv.unit той же таблицей алиасов. ──
      FOR v_snap_item IN SELECT * FROM jsonb_array_elements(v_snap -> 'items') LOOP
        FOR v_ing IN SELECT * FROM jsonb_array_elements(v_snap_item -> 'ingredients') LOOP
          v_norm_inv_id := NULLIF(btrim(COALESCE(v_ing ->> 'inventory_item_id', '')), '');
          v_inv_id := NULL;
          v_inv_unit := NULL;
          IF v_norm_inv_id IS NOT NULL THEN
            SELECT id, unit INTO v_inv_id, v_inv_unit
              FROM public.inventory_items
             WHERE id = v_norm_inv_id::uuid
               AND owner_id = v_owner
               AND is_active;
          ELSE
            SELECT id, unit INTO v_inv_id, v_inv_unit
              FROM public.inventory_items
             WHERE owner_id = v_owner
               AND is_active
               AND lower(btrim(name)) = lower(btrim(v_ing ->> 'name'))
             LIMIT 1;
          END IF;
          IF v_inv_id IS NULL THEN
            CONTINUE;  -- позиции нет на складе — в expected не входит (no_stock)
          END IF;
          v_contrib := public.inventory_unit_convert_qty(
            (v_ing ->> 'qty')::numeric * (v_snap_item ->> 'quantity')::numeric,
            v_ing ->> 'unit',
            COALESCE(v_inv_unit, 'шт')
          );
          IF v_contrib IS NULL THEN
            v_mismatch_map := v_mismatch_map || jsonb_build_object(v_inv_id::text, true);
          ELSE
            v_expected_map := jsonb_set(
              v_expected_map,
              ARRAY[v_inv_id::text],
              to_jsonb(COALESCE((v_expected_map ->> v_inv_id::text)::numeric, 0) + v_contrib)
            );
          END IF;
        END LOOP;
      END LOOP;

      -- Уже списанное по этому заказу (реестр 0049; quantities в единицах
      -- склада). Свою свежевставленную строку (шаг 2) ИСКЛЮЧАЕМ — паритет
      -- с прежней TS-валидацией (она читала реестр до вставки своей строки).
      FOR v_reg_items IN
        -- Считаем только фактически применённые движения из result.applied.
        -- w.items содержит исходный запрос и включает позиции, которые могли
        -- завершиться failed; считать их списанными запрещено.
        SELECT COALESCE(w.result -> 'applied', '[]'::jsonb)
          FROM public.inventory_write_offs w
         WHERE w.owner_id = p_owner_id
           AND w.order_id = p_order_id
           AND w.id <> v_row.id
      LOOP
        IF v_reg_items IS NULL OR jsonb_typeof(v_reg_items) <> 'array' THEN
          CONTINUE;
        END IF;
        FOR v_elem IN SELECT * FROM jsonb_array_elements(v_reg_items) LOOP
          IF COALESCE((v_elem ->> 'quantity')::numeric, 0) > 0 THEN
            v_already_map := jsonb_set(
              v_already_map,
              ARRAY[COALESCE(v_elem ->> 'item_id', '')],
              to_jsonb(
                COALESCE((v_already_map ->> COALESCE(v_elem ->> 'item_id', ''))::numeric, 0)
                + (v_elem ->> 'quantity')::numeric
              )
            );
          END IF;
        END LOOP;
      END LOOP;

      -- ── Шаг 5: проверка переданных позиций против норматива
      --    (not_in_snapshot / unit_mismatch / overage; допуск 1e-6 —
      --    погрешность округления round6, не бизнес-допуск). ──
      FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_item_id := (v_elem ->> 'item_id')::uuid;
        v_qty := (v_elem ->> 'quantity')::numeric;
        IF v_mismatch_map ? v_item_id::text THEN
          v_deviations := v_deviations || jsonb_build_object(
            'item_id', v_item_id::text, 'kind', 'unit_mismatch',
            'expected_remaining', NULL::numeric, 'got', v_qty);
        ELSIF NOT v_expected_map ? v_item_id::text THEN
          v_deviations := v_deviations || jsonb_build_object(
            'item_id', v_item_id::text, 'kind', 'not_in_snapshot',
            'expected_remaining', NULL::numeric, 'got', v_qty);
        ELSE
          v_exp := (v_expected_map ->> v_item_id::text)::numeric;
          v_remaining := v_exp - COALESCE((v_already_map ->> v_item_id::text)::numeric, 0);
          IF v_qty > v_remaining + 0.000001 THEN
            v_deviations := v_deviations || jsonb_build_object(
              'item_id', v_item_id::text, 'kind', 'overage',
              'expected_remaining', GREATEST(0, round(v_remaining * 1000000) / 1000000),
              'got', v_qty);
          END IF;
        END IF;
      END LOOP;

      IF jsonb_array_length(v_deviations) > 0 THEN
        IF p_allow_overage IS NOT TRUE THEN
          RAISE EXCEPTION '[order_write_off] snapshot_mismatch:%', v_deviations::text;
        END IF;
        v_overage := true;  -- ручная корректировка: причина помечается ниже
      END IF;
    END IF;
  END IF;

  -- ── Шаг 6: применение движений. Блокировка позиций FOR UPDATE В
  --    ОТСОРТИРОВАННОМ порядке item_id (анти-deadlock между параллельными
  --    списаниями и одиночными движениями 0048); guard «остаток ≥ 0»;
  --    UPDATE остатка + INSERT журнала — семантика 0048 на каждую позицию.
  --    Частичный успех разрешён (applied+failed); полный провал → RAISE. ──
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_overage THEN
    v_reason := COALESCE(v_reason, '') || ' (превышение норматива snapshot подтверждено оператором)';
  END IF;

  FOR v_elem IN
    SELECT * FROM jsonb_array_elements(p_items) AS e(elem)
     ORDER BY elem ->> 'item_id'
  LOOP
    v_item_id := (v_elem ->> 'item_id')::uuid;
    v_qty := (v_elem ->> 'quantity')::numeric;

    SELECT * INTO v_inv
      FROM public.inventory_items
     WHERE id = v_item_id
     FOR UPDATE;

    IF NOT FOUND THEN
      v_failed := v_failed || jsonb_build_object('item_id', v_item_id::text, 'error', 'Позиция не найдена');
      IF v_first_kind IS NULL THEN v_first_kind := 'not_found'; END IF;
      CONTINUE;
    END IF;

    IF v_inv.owner_id IS DISTINCT FROM p_owner_id AND p_actor_is_admin IS NOT TRUE THEN
      v_failed := v_failed || jsonb_build_object('item_id', v_item_id::text, 'error', 'Нет доступа к этой позиции склада');
      IF v_first_kind IS NULL THEN v_first_kind := 'forbidden'; END IF;
      CONTINUE;
    END IF;

    v_new_qty := COALESCE(v_inv.quantity, 0) - v_qty;
    IF v_new_qty < 0 THEN
      v_failed := v_failed || jsonb_build_object(
        'item_id', v_item_id::text,
        'error', 'Недостаточно на складе: доступно ' || COALESCE(v_inv.quantity, 0)::text);
      IF v_first_kind IS NULL THEN
        v_first_kind := 'insufficient';
        v_first_available := COALESCE(v_inv.quantity, 0);
      END IF;
      CONTINUE;
    END IF;

    UPDATE public.inventory_items
       SET quantity = v_new_qty,
           updated_at = now()
     WHERE id = v_item_id;

    INSERT INTO public.inventory_movements
      (item_id, user_id, type, quantity, reason, order_id)
    VALUES
      (v_item_id, p_owner_id, 'OUT', v_qty, v_reason, p_order_id)
    RETURNING id INTO v_movement;

    v_applied := v_applied || jsonb_build_object(
      'item_id',     v_item_id::text,
      'item_name',   v_inv.name,
      'movement_id', v_movement::text,
      'quantity',    v_qty,
      'remaining',   v_new_qty,
      'unit',        v_inv.unit
    );
  END LOOP;

  -- Ни одна позиция не списана → ошибка первой причины, ПОЛНЫЙ откат
  -- (движений нет, реестровая строка шага 2 откачена — паритет route).
  IF v_first_kind IS NOT NULL AND jsonb_array_length(v_applied) = 0 THEN
    IF v_first_kind = 'insufficient' THEN
      RAISE EXCEPTION '[order_write_off] apply_failed:insufficient:%', v_first_available::text;
    ELSIF v_first_kind = 'forbidden' THEN
      RAISE EXCEPTION '[order_write_off] apply_failed:forbidden';
    ELSE
      RAISE EXCEPTION '[order_write_off] apply_failed:not_found';
    END IF;
  END IF;

  -- ── Шаг 7: успех — фиксируем результат в реестре и возвращаем ──
  UPDATE public.inventory_write_offs
     SET result = jsonb_build_object('applied', v_applied, 'failed', v_failed)
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'applied',   v_applied,
    'failed',    v_failed,
    'order_id',  p_order_id,
    'validation_mode', v_mode,
    'overage_confirmed', v_overage,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.apply_order_write_off_atomic(uuid, uuid, jsonb, text, text, boolean, boolean) IS
  'Z-v32/ZV31-002: атомарное кумулятивное order-списание; FOR UPDATE заказа + реестр-первым + перепроверка snapshot в транзакции';

-- ============================================================================
-- 3. ZV31-003: атомарный PATCH рецепта (корень + состав в одной транзакции)
--    p_root/p_steps/p_ingredients/p_variants/p_sources = NULL → тип не трогается.
--    p_ingredients = '[]' → очистить состав. p_substitutes резолвятся по
--    ingredient_position на свежевставленные id ВНУТРИ транзакции.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_recipe_with_ingredients(
  p_recipe_id    uuid,
  p_root         jsonb DEFAULT NULL,   -- whitelist-поля корня (только переданные ключи)
  p_steps        jsonb DEFAULT NULL,
  p_ingredients  jsonb DEFAULT NULL,
  p_substitutes  jsonb DEFAULT NULL,   -- [{ingredient_position, name, qty, unit, position}]
  p_variants     jsonb DEFAULT NULL,
  p_sources      jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cnt integer := 0;
BEGIN
  IF p_recipe_id IS NULL THEN
    RAISE EXCEPTION '[recipe_patch] p_recipe_id обязателен';
  END IF;

  -- ── Блокировка строки корня: параллельные PATCH одного рецепта
  --    сериализуются; concurrent read (MVCC) видит ЛИБО старое, ЛИБО новое
  --    состояние целиком — промежуточный «пустой состав» невозможен. ──
  IF NOT EXISTS (
    SELECT 1 FROM public.recipes WHERE id = p_recipe_id FOR UPDATE
  ) THEN
    RAISE EXCEPTION '[recipe_patch] not_found:%', p_recipe_id::text;
  END IF;

  -- ── Корень: обновляются ТОЛЬКО ключи, присутствующие в p_root
  --    (whitelist собирает маршрут; статус/author_id/id клиентом не управляются). ──
  IF p_root IS NOT NULL AND p_root <> '{}'::jsonb THEN
    UPDATE public.recipes SET
      title                = CASE WHEN p_root ? 'title'                 THEN p_root ->> 'title'                                  ELSE title END,
      slug                 = CASE WHEN p_root ? 'slug'                  THEN p_root ->> 'slug'                                   ELSE slug END,
      description          = CASE WHEN p_root ? 'description'           THEN p_root ->> 'description'                            ELSE description END,
      subtitle             = CASE WHEN p_root ? 'subtitle'              THEN p_root ->> 'subtitle'                               ELSE subtitle END,
      difficulty           = CASE WHEN p_root ? 'difficulty'            THEN p_root ->> 'difficulty'                             ELSE difficulty END,
      prep_time_minutes    = CASE WHEN p_root ? 'prep_time_minutes'     THEN (p_root ->> 'prep_time_minutes')::int               ELSE prep_time_minutes END,
      cook_time_minutes    = CASE WHEN p_root ? 'cook_time_minutes'     THEN (p_root ->> 'cook_time_minutes')::int               ELSE cook_time_minutes END,
      servings             = CASE WHEN p_root ? 'servings'              THEN (p_root ->> 'servings')::int                        ELSE servings END,
      calories_per_serving = CASE WHEN p_root ? 'calories_per_serving'  THEN (p_root ->> 'calories_per_serving')::int            ELSE calories_per_serving END,
      protein_g            = CASE WHEN p_root ? 'protein_g'             THEN (p_root ->> 'protein_g')::numeric                   ELSE protein_g END,
      fat_g                = CASE WHEN p_root ? 'fat_g'                 THEN (p_root ->> 'fat_g')::numeric                       ELSE fat_g END,
      carb_g               = CASE WHEN p_root ? 'carb_g'                THEN (p_root ->> 'carb_g')::numeric                      ELSE carb_g END,
      tags                 = CASE WHEN p_root ? 'tags'                  THEN ARRAY(SELECT jsonb_array_elements_text(p_root -> 'tags'))     ELSE tags END,
      category             = CASE WHEN p_root ? 'category'              THEN p_root ->> 'category'                               ELSE category END,
      equipment            = CASE WHEN p_root ? 'equipment'             THEN ARRAY(SELECT jsonb_array_elements_text(p_root -> 'equipment')) ELSE equipment END,
      allergens            = CASE WHEN p_root ? 'allergens'             THEN ARRAY(SELECT jsonb_array_elements_text(p_root -> 'allergens')) ELSE allergens END,
      yield_text           = CASE WHEN p_root ? 'yield_text'            THEN p_root ->> 'yield_text'                             ELSE yield_text END,
      storage_note         = CASE WHEN p_root ? 'storage_note'          THEN p_root ->> 'storage_note'                           ELSE storage_note END,
      updated_at           = CASE WHEN p_root ? 'updated_at'            THEN (p_root ->> 'updated_at')::timestamptz              ELSE updated_at END
    WHERE id = p_recipe_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt = 0 THEN
      RAISE EXCEPTION '[recipe_patch] not_found:%', p_recipe_id::text;
    END IF;
  END IF;

  -- ── Шаги (замена каскадно удаляет media шагов — recipe_media.step_id
  --    ON DELETE CASCADE, 0066; манифест медиа сохранён в версиях RA.8.1) ──
  IF p_steps IS NOT NULL THEN
    DELETE FROM public.recipe_steps WHERE recipe_id = p_recipe_id;
    IF jsonb_array_length(p_steps) > 0 THEN
      INSERT INTO public.recipe_steps
        (recipe_id, position, title, description, time_min, time_max, temperature_c, tips)
      SELECT p_recipe_id, x.position, x.title, x.description, x.time_min, x.time_max, x.temperature_c, x.tips
        FROM jsonb_to_recordset(p_steps)
             AS x("position" int, title text, description text, time_min int, time_max int, temperature_c int, tips text);
    END IF;
  END IF;

  -- ── Ингредиенты + замены (substitutes удаляются CASCADE с ингредиентами;
  --    привязка к свежим id — по нормализованной position, паритет
  --    substituteRowsFromDto) ──
  IF p_ingredients IS NOT NULL THEN
    DELETE FROM public.recipe_ingredients WHERE recipe_id = p_recipe_id;
    IF jsonb_array_length(p_ingredients) > 0 THEN
      INSERT INTO public.recipe_ingredients
        (recipe_id, name, qty, unit, display_qty, is_optional, prep_note, group_title, position, sort_order)
      SELECT p_recipe_id, x.name, x.qty, x.unit, x.display_qty,
             COALESCE(x.is_optional, false), x.prep_note, x.group_title, x.position,
             COALESCE(x.sort_order, COALESCE(x.position, 1) - 1)
        FROM jsonb_to_recordset(p_ingredients)
             AS x(name text, qty numeric, unit text, display_qty text, is_optional boolean,
                  prep_note text, group_title text, "position" int, sort_order int);

      IF p_substitutes IS NOT NULL AND jsonb_array_length(p_substitutes) > 0 THEN
        INSERT INTO public.recipe_ingredient_substitutes
          (ingredient_id, name, qty, unit, position)
        SELECT ri.id, s.name, s.qty, s.unit, s.position
          FROM jsonb_to_recordset(p_substitutes)
               AS s(ingredient_position int, name text, qty numeric, unit text, "position" int)
          JOIN public.recipe_ingredients ri
            ON ri.recipe_id = p_recipe_id AND ri.position = s.ingredient_position;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> jsonb_array_length(p_substitutes) THEN
          RAISE EXCEPTION '[recipe_patch] substitute_position_unresolved';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── Варианты ──
  IF p_variants IS NOT NULL THEN
    DELETE FROM public.recipe_variants WHERE recipe_id = p_recipe_id;
    IF jsonb_array_length(p_variants) > 0 THEN
      INSERT INTO public.recipe_variants
        (recipe_id, title, description, is_default, overrides, servings)
      SELECT p_recipe_id, x.title, x.description, COALESCE(x.is_default, false),
             COALESCE(x.overrides, '[]'::jsonb), x.servings
        FROM jsonb_to_recordset(p_variants)
             AS x(title text, description text, is_default boolean, overrides jsonb, servings int);
    END IF;
  END IF;

  -- ── Источники: полная замена сбрасывает права (новый источник = новое
  --    подтверждение, RA.13): rights_confirmed ЖЁСТКО false ──
  IF p_sources IS NOT NULL THEN
    DELETE FROM public.recipe_sources WHERE recipe_id = p_recipe_id;
    IF jsonb_array_length(p_sources) > 0 THEN
      INSERT INTO public.recipe_sources
        (recipe_id, source_type, source_url, source_author, source_published_at, import_method, raw_payload, rights_confirmed)
      SELECT p_recipe_id, x.source_type, x.source_url, x.source_author,
             (NULLIF(btrim(COALESCE(x.source_published_at, '')), ''))::timestamptz,
             x.import_method, x.raw_payload, false
        FROM jsonb_to_recordset(p_sources)
             AS x(source_type text, source_url text, source_author text, source_published_at text,
                  import_method text, raw_payload jsonb);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'recipe_id', p_recipe_id);
END;
$$;

COMMENT ON FUNCTION public.update_recipe_with_ingredients(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) IS
  'Z-v32/ZV31-003: атомарный PATCH рецепта — корень + полная замена переданных типов детей в одной транзакции (FOR UPDATE корня)';

-- ============================================================================
-- 4. GRANT-дисциплина (SEC-10): EXECUTE — только service_role
-- ============================================================================
REVOKE ALL ON FUNCTION public.inventory_unit_alias_info(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_unit_alias_info(text) FROM anon;
REVOKE ALL ON FUNCTION public.inventory_unit_alias_info(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.inventory_unit_convert_qty(numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_unit_convert_qty(numeric, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.inventory_unit_convert_qty(numeric, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.apply_order_write_off_atomic(uuid, uuid, jsonb, text, text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_order_write_off_atomic(uuid, uuid, jsonb, text, text, boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.apply_order_write_off_atomic(uuid, uuid, jsonb, text, text, boolean, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION public.update_recipe_with_ingredients(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_recipe_with_ingredients(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.update_recipe_with_ingredients(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_unit_alias_info(text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_unit_convert_qty(numeric, text, text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_order_write_off_atomic(uuid, uuid, jsonb, text, text, boolean, boolean) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_recipe_with_ingredients(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role';
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK PLAN (выполняется вручную):
-- DROP FUNCTION IF EXISTS public.update_recipe_with_ingredients(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);
-- DROP FUNCTION IF EXISTS public.apply_order_write_off_atomic(uuid, uuid, jsonb, text, text, boolean, boolean);
-- DROP FUNCTION IF EXISTS public.inventory_unit_convert_qty(numeric, text, text);
-- DROP FUNCTION IF EXISTS public.inventory_unit_alias_info(text);
-- (данные не меняются; маршруты до отката миграции вернут 500 fail-closed)
-- ============================================================================
