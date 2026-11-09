-- ============================================================================
-- 0070_recipe_production_contour.sql — RECIPE-02 (Этап B, RB.17/RA.17.6)
--
-- Производственный контур (уровень C, §F.9–F.11 + RA.11.1):
--   1. recipe_production_cards          — карты кондитера (owner = UUID auth.users,
--                                         ПР-7/RB.13; НЕ confectioners.id);
--   2. recipe_production_ingredients    — нормы сырья (inventory_item_id RESTRICT,
--                                         RB.13 прим.2 — защита норм);
--   3. recipe_production_card_versions  — неизменяемые версии карты (approve,
--                                         RB.15; SELECT-only RLS);
--   4. recipe_card_cost_history         — история себестоимости (РЕШ-4/Q-9:
--                                         целые рубли; копеечная детализация —
--                                         только внутри breakdown JSONB);
--   5. recipe_production_batches        — производственные партии (RA.11.1:
--                                         card_version_id RESTRICT, owner RESTRICT).
--
-- RLS (RB.16): ENABLE; SELECT owner/ADMIN; мутации — owner; card_versions и
-- cost_history — SELECT-only (без мутационных политик, запись через
-- service_role). DELETE партий — владелец и только ДО списания (гварда по
-- inventory_write_offs.batch_id — RB.16 «owner (до списания)»).
--
-- GRANT не выдаются (НФ-1/НФ-2; весь доступ через API-слой).
--
-- Идемпотентность: CREATE TABLE IF NOT EXISTS (inline-констрейнты атомарны),
-- частичный UNIQUE — CREATE UNIQUE INDEX IF NOT EXISTS, триггеры — DO-гварды
-- pg_trigger, updated_at — общий хендлер handle_updated_at (0001).
-- ============================================================================

-- ============================================================================
-- 1. recipe_production_cards — производственные карты (§F.9)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_production_cards (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id         UUID NOT NULL REFERENCES public.recipes(id) ON DELETE RESTRICT,
  -- Версия рецепта, на нормы которой опирается карта («норма зафиксирована»);
  -- nullable для черновика, обязательность контролирует approve (API, RB.15)
  recipe_version_id UUID REFERENCES public.recipe_versions(id) ON DELETE RESTRICT,
  product_id        UUID REFERENCES public.products(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','archived')),
  approved_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  batch_yield_qty   NUMERIC(12,3),
  batch_yield_unit  TEXT,
  portions_per_batch INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 1:1 факультативно: одна карта владельца на товар (§F.9, RB.17 0070)
  CONSTRAINT uq_recipe_production_cards_owner_product
    UNIQUE (owner_id, product_id)
);

COMMENT ON TABLE public.recipe_production_cards IS
  'RECIPE-02: производственная карта кондитера (уровень C); владение — UUID auth.users (ПР-7)';
COMMENT ON COLUMN public.recipe_production_cards.recipe_version_id IS
  'Версия рецепта, к нормам которой привязана карта; фиксируется при approve';

ALTER TABLE public.recipe_production_cards ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_cards' AND policyname = 'recipe_production_cards_select') THEN
    CREATE POLICY recipe_production_cards_select ON public.recipe_production_cards
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

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_cards' AND policyname = 'recipe_production_cards_insert_own') THEN
    CREATE POLICY recipe_production_cards_insert_own ON public.recipe_production_cards
      FOR INSERT TO authenticated
      WITH CHECK (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_cards' AND policyname = 'recipe_production_cards_update_own') THEN
    CREATE POLICY recipe_production_cards_update_own ON public.recipe_production_cards
      FOR UPDATE TO authenticated
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_cards' AND policyname = 'recipe_production_cards_delete_own') THEN
    CREATE POLICY recipe_production_cards_delete_own ON public.recipe_production_cards
      FOR DELETE TO authenticated
      USING (owner_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_production_cards_owner
  ON public.recipe_production_cards (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_recipe_production_cards_recipe
  ON public.recipe_production_cards (recipe_id);

-- ============================================================================
-- 2. recipe_production_ingredients — нормы сырья карты (§F.10)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_production_ingredients (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id              UUID NOT NULL REFERENCES public.recipe_production_cards(id) ON DELETE CASCADE,
  -- Публичный ингредиент-прототип (связь с рецептом; nullable)
  source_ingredient_id UUID REFERENCES public.recipe_ingredients(id) ON DELETE SET NULL,
  -- Конкретная складская позиция; при approve — обязательна (API, RB.15);
  -- RESTRICT — защита норм (RB.13 прим.2)
  inventory_item_id    UUID REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  qty_per_unit         NUMERIC(12,3) NOT NULL CHECK (qty_per_unit > 0),
  qty_per_batch        NUMERIC(12,3),
  unit                 TEXT NOT NULL,
  brutto_qty           NUMERIC(12,3),
  waste_pct            NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 100),
  is_optional          BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recipe_production_ingredients IS
  'RECIPE-02: нормы сырья карты; «Мука» публичного рецепта ≠ «Мука пш. в/с, поставщик X» — связь только здесь (§F.10)';

ALTER TABLE public.recipe_production_ingredients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_ingredients' AND policyname = 'recipe_production_ingredients_select') THEN
    CREATE POLICY recipe_production_ingredients_select ON public.recipe_production_ingredients
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipe_production_cards c
           WHERE c.id = recipe_production_ingredients.card_id
             AND (c.owner_id = auth.uid()
               OR EXISTS (
                 SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid()
                    AND ur.role IN ('ADMIN','SUPER_ADMIN')
                    AND ur.is_active
               ))
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_ingredients' AND policyname = 'recipe_production_ingredients_write_own') THEN
    CREATE POLICY recipe_production_ingredients_write_own ON public.recipe_production_ingredients
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipe_production_cards c
           WHERE c.id = recipe_production_ingredients.card_id
             AND c.owner_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.recipe_production_cards c
           WHERE c.id = recipe_production_ingredients.card_id
             AND c.owner_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_production_ingredients_card
  ON public.recipe_production_ingredients (card_id);

-- ============================================================================
-- 3. recipe_production_card_versions — неизменяемые версии карты (RB.15)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_production_card_versions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id     UUID NOT NULL REFERENCES public.recipe_production_cards(id) ON DELETE CASCADE,
  version_no  INT  NOT NULL,
  -- Полный снимок карты+норм на момент approve (история воспроизводима,
  -- RB.13 прим.4: снапшоты включают манифест норм и цен на момент)
  snapshot    JSONB NOT NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_recipe_production_card_versions UNIQUE (card_id, version_no)
);

COMMENT ON TABLE public.recipe_production_card_versions IS
  'RECIPE-02: неизменяемые версии производственной карты; иммутабельность = отсутствие мутационных RLS-политик (RB.16)';

ALTER TABLE public.recipe_production_card_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- SELECT-only: owner/ADMIN (RB.16). Мутационных политик НЕТ намеренно.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_card_versions' AND policyname = 'recipe_production_card_versions_select') THEN
    CREATE POLICY recipe_production_card_versions_select ON public.recipe_production_card_versions
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipe_production_cards c
           WHERE c.id = recipe_production_card_versions.card_id
             AND (c.owner_id = auth.uid()
               OR EXISTS (
                 SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid()
                    AND ur.role IN ('ADMIN','SUPER_ADMIN')
                    AND ur.is_active
               ))
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_production_card_versions_card
  ON public.recipe_production_card_versions (card_id, version_no DESC);

-- ============================================================================
-- 4. recipe_card_cost_history — история себестоимости (§F.11 + РЕШ-4/Q-9)
--    Деньги: целые рубли (канон 0034:76-77; РЕШ-4 RECIPE-01B). Копеечная
--    детализация — только внутри breakdown JSONB (Q-9: «копейки только в
--    breakdown-JSONB промежуточно»). Интерпретация имен F.11 (_kopecks
--    BIGINT) задокументирована в отчёте.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_card_cost_history (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id           UUID NOT NULL REFERENCES public.recipe_production_cards(id) ON DELETE CASCADE,
  card_version_id   UUID NOT NULL REFERENCES public.recipe_production_card_versions(id) ON DELETE RESTRICT,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cost_per_unit_rub  INTEGER NOT NULL CHECK (cost_per_unit_rub >= 0),
  cost_per_batch_rub INTEGER NOT NULL CHECK (cost_per_batch_rub >= 0),
  -- Позиции: [{inventory_item_id, name, qty, unit, unit_price, cost}] (детализация)
  breakdown         JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_basis       TEXT NOT NULL CHECK (price_basis IN ('inventory_current','inventory_at')),
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recipe_card_cost_history IS
  'RECIPE-02: история себестоимости per card_version; последующие изменения цен не переписывают историю (§F.11, RA.12)';

ALTER TABLE public.recipe_card_cost_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- SELECT-only: owner/ADMIN (RB.16). Запись — service_role (серверный калькулятор).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_card_cost_history' AND policyname = 'recipe_card_cost_history_select') THEN
    CREATE POLICY recipe_card_cost_history_select ON public.recipe_card_cost_history
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.recipe_production_cards c
           WHERE c.id = recipe_card_cost_history.card_id
             AND (c.owner_id = auth.uid()
               OR EXISTS (
                 SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = auth.uid()
                    AND ur.role IN ('ADMIN','SUPER_ADMIN')
                    AND ur.is_active
               ))
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_card_cost_history_version
  ON public.recipe_card_cost_history (card_version_id, computed_at DESC);

-- ============================================================================
-- 5. recipe_production_batches — производственные партии (RA.11.1 — дословно)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recipe_production_batches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_version_id UUID NOT NULL REFERENCES public.recipe_production_card_versions(id) ON DELETE RESTRICT,
  owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  order_id        UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  planned_qty     NUMERIC(12,3) NOT NULL CHECK (planned_qty > 0),
  planned_unit    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','in_progress','completed','cancelled')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recipe_production_batches IS
  'RECIPE-02: производственные партии; бизнес-ключ списания вне заказа (RA.11.1); completed требует ровно одного списания (batch_id UNIQUE, RB.15)';

ALTER TABLE public.recipe_production_batches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_batches' AND policyname = 'recipe_production_batches_select') THEN
    CREATE POLICY recipe_production_batches_select ON public.recipe_production_batches
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

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_batches' AND policyname = 'recipe_production_batches_insert_own') THEN
    CREATE POLICY recipe_production_batches_insert_own ON public.recipe_production_batches
      FOR INSERT TO authenticated
      WITH CHECK (owner_id = auth.uid());
  END IF;

  -- UPDATE: статусные переходы владельца (RB.15); клиентские мутации чужих — deny
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_batches' AND policyname = 'recipe_production_batches_update_own') THEN
    CREATE POLICY recipe_production_batches_update_own ON public.recipe_production_batches
      FOR UPDATE TO authenticated
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;

  -- DELETE: владелец. Усиление «до списания» (гварда по inventory_write_offs
  -- .batch_id) добавляет 0071 — колонка batch_id появляется только там;
  -- ссылка на неё в 0070 сломала бы парсинг политики (порядок ledger).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipe_production_batches' AND policyname = 'recipe_production_batches_delete_own') THEN
    CREATE POLICY recipe_production_batches_delete_own ON public.recipe_production_batches
      FOR DELETE TO authenticated
      USING (owner_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipe_production_batches_version
  ON public.recipe_production_batches (card_version_id);
CREATE INDEX IF NOT EXISTS idx_recipe_production_batches_owner
  ON public.recipe_production_batches (owner_id, created_at DESC);

-- ============================================================================
-- 6. updated_at-триггеры (общий хендлер handle_updated_at из 0001)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgname = 'trg_recipe_production_cards_updated_at'
         AND tgrelid = 'public.recipe_production_cards'::regclass
         AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_recipe_production_cards_updated_at
        BEFORE UPDATE ON public.recipe_production_cards
        FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgname = 'trg_recipe_production_batches_updated_at'
         AND tgrelid = 'public.recipe_production_batches'::regclass
         AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER trg_recipe_production_batches_updated_at
        BEFORE UPDATE ON public.recipe_production_batches
        FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
    END IF;
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK PLAN (RA.17; выполняется вручную, порядок обратный применению)
-- ============================================================================
-- DROP TRIGGER IF EXISTS trg_recipe_production_batches_updated_at ON public.recipe_production_batches;
-- DROP TRIGGER IF EXISTS trg_recipe_production_cards_updated_at ON public.recipe_production_cards;
-- DROP POLICY IF EXISTS recipe_production_batches_select ON public.recipe_production_batches;
-- DROP POLICY IF EXISTS recipe_production_batches_insert_own ON public.recipe_production_batches;
-- DROP POLICY IF EXISTS recipe_production_batches_update_own ON public.recipe_production_batches;
-- DROP POLICY IF EXISTS recipe_production_batches_delete_own ON public.recipe_production_batches;  -- 0071 усиливает её; при откате обоих файлов удаляется здесь
-- DROP TABLE IF EXISTS public.recipe_production_batches CASCADE;
-- DROP POLICY IF EXISTS recipe_card_cost_history_select ON public.recipe_card_cost_history;
-- DROP TABLE IF EXISTS public.recipe_card_cost_history CASCADE;
-- DROP POLICY IF EXISTS recipe_production_card_versions_select ON public.recipe_production_card_versions;
-- DROP TABLE IF EXISTS public.recipe_production_card_versions CASCADE;
-- DROP POLICY IF EXISTS recipe_production_ingredients_select ON public.recipe_production_ingredients;
-- DROP POLICY IF EXISTS recipe_production_ingredients_write_own ON public.recipe_production_ingredients;
-- DROP TABLE IF EXISTS public.recipe_production_ingredients CASCADE;
-- DROP POLICY IF EXISTS recipe_production_cards_select ON public.recipe_production_cards;
-- DROP POLICY IF EXISTS recipe_production_cards_insert_own ON public.recipe_production_cards;
-- DROP POLICY IF EXISTS recipe_production_cards_update_own ON public.recipe_production_cards;
-- DROP POLICY IF EXISTS recipe_production_cards_delete_own ON public.recipe_production_cards;
-- DROP TABLE IF EXISTS public.recipe_production_cards CASCADE;
