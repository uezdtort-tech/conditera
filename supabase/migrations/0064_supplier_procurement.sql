-- ============================================================================
-- 0064_supplier_procurement.sql — Z-v17: функциональный контур поставщика и
-- закупочных заказов.
--
-- Блоки:
--   1. supplier_profiles — статусы модерации + расширенный профиль компании
--      (переиспользуем существующую таблицу 0017, camelCase-колонки сохранены).
--   2. supplier_profile_reviews — журнал модерации (кто/когда/что/почему).
--   3. supplier_products — публикация каталога, MOQ/кратность, резерв остатка
--      (расширение таблицы 0019; существующие колонки не менялись).
--   4. supplier_product_movements — журнал движения остатков (резерв/освобождение/
--      списание/пополнение) — расширение склада поставщика, аналогичное по смыслу
--      inventory_movements (0046), но привязанное к supplier_products
--      (inventory_movements.item_id имеет жёсткий FK на inventory_items и не
--      может использоваться для товаров поставщика без ломающего изменения).
--   5. purchase_orders / purchase_order_items / purchase_order_status_history —
--      закупочные заказы кондитер → поставщик (новая сущность: purchase_drafts
--      из 0053 — внутренние черновики закупки без supplier_id, статусов
--      поставщика и резерва, дубликатом не являются).
--   6. RLS: SELECT для участников, мутации — только service role (серверные API).
--
-- Все изменения идемпотентны (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================================

-- ============================================================================
-- 1. supplier_profiles: модерация + профиль компании
-- ============================================================================
ALTER TABLE "supplier_profiles"
  ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'draft'
    CHECK ("verificationStatus" IN
      ('draft','submitted','under_review','changes_requested','approved','rejected','suspended')),
  ADD COLUMN IF NOT EXISTS "legalForm" TEXT,
  ADD COLUMN IF NOT EXISTS "contactPerson" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "specialization" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "productCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "wholesaleTerms" TEXT,
  ADD COLUMN IF NOT EXISTS "workSchedule" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryGeography" TEXT,
  ADD COLUMN IF NOT EXISTS "pickupAvailable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deliveryAvailable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "documents" JSONB,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "reviewComment" TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMPTZ;

-- Backfill: уже работающие активные поставщики считаются одобренными.
UPDATE "supplier_profiles"
   SET "verificationStatus" = 'approved'
 WHERE "isActive" = true
   AND "verificationStatus" = 'draft';

CREATE INDEX IF NOT EXISTS idx_supplier_profiles_verification
  ON "supplier_profiles" ("verificationStatus");
CREATE INDEX IF NOT EXISTS idx_supplier_profiles_user
  ON "supplier_profiles" ("userId");

-- ============================================================================
-- 2. supplier_profile_reviews — журнал модерации
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.supplier_profile_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   TEXT NOT NULL REFERENCES "supplier_profiles"(id) ON DELETE CASCADE,
  action       TEXT NOT NULL CHECK (action IN
    ('submitted','under_review','approved','rejected','changes_requested','suspended','resumed','profile_updated')),
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role   TEXT,
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_reviews_profile
  ON public.supplier_profile_reviews (profile_id, created_at DESC);

ALTER TABLE public.supplier_profile_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_reviews_select_parties" ON public.supplier_profile_reviews;
-- supplier_profiles."userId" — TEXT (историческая модель идентификаторов 0017,
-- как у всех profile-таблиц), поэтому сравниваем с auth.uid()::text —
-- канонический паттерн проекта (0014/0022/0023/0026/0027).
-- auth.users-UUID-колонки (actor_id, supplier_id, buyer_id) сравниваются напрямую.
CREATE POLICY "supplier_reviews_select_parties" ON public.supplier_profile_reviews
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "supplier_profiles" sp
      WHERE sp.id = supplier_profile_reviews.profile_id
        AND (sp."userId" = auth.uid()::text
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active = true))
    )
  );

-- ============================================================================
-- 3. supplier_products: каталог + MOQ + резерв
-- ============================================================================
ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  ADD COLUMN IF NOT EXISTS producer TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS min_order_qty INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS order_step INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reserved_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER,
  ADD COLUMN IF NOT EXISTS storage_conditions TEXT,
  ADD COLUMN IF NOT EXISTS delivery_region TEXT,
  ADD COLUMN IF NOT EXISTS price_valid_until DATE,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Guard'ы корректности остатков.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_products_reserved_nonneg') THEN
    ALTER TABLE public.supplier_products
      ADD CONSTRAINT supplier_products_reserved_nonneg CHECK (reserved_quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_products_reserved_le_qty') THEN
    ALTER TABLE public.supplier_products
      ADD CONSTRAINT supplier_products_reserved_le_qty CHECK (reserved_quantity <= quantity);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_products_qty_nonneg') THEN
    ALTER TABLE public.supplier_products
      ADD CONSTRAINT supplier_products_qty_nonneg CHECK (quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_products_moq_positive') THEN
    ALTER TABLE public.supplier_products
      ADD CONSTRAINT supplier_products_moq_positive CHECK (min_order_qty >= 1 AND order_step >= 1);
  END IF;
END $$;

-- Backfill: активные товары становятся опубликованными.
UPDATE public.supplier_products
   SET status = 'published', published_at = COALESCE(published_at, NOW())
 WHERE is_active = true AND status = 'draft';

CREATE INDEX IF NOT EXISTS idx_supplier_products_status
  ON public.supplier_products (status);
CREATE INDEX IF NOT EXISTS idx_supplier_products_public_catalog
  ON public.supplier_products (status, is_active) WHERE status = 'published';

-- ============================================================================
-- 4. supplier_product_movements — журнал остатков поставщика
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.supplier_product_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES public.supplier_products(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('RESERVE','RELEASE','OUT','IN','ADJUST')),
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  order_id    UUID, -- FK на purchase_orders добавляется в блоке 5
  reason      TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- (order_id добавляется после создания purchase_orders — см. ниже; здесь
--  таблица создаётся без FK, FK добавляется в блоке 5.)

CREATE INDEX IF NOT EXISTS idx_supplier_movements_product
  ON public.supplier_product_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_movements_order
  ON public.supplier_product_movements (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.supplier_product_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_movements_select_own_or_admin" ON public.supplier_product_movements;
CREATE POLICY "supplier_movements_select_own_or_admin" ON public.supplier_product_movements
  FOR SELECT USING (
    supplier_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active = true)
  );

-- ============================================================================
-- 5. purchase_orders — закупочные заказы кондитер → поставщик
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.purchase_order_status AS ENUM (
    'DRAFT','SUBMITTED','CONFIRMED','REJECTED','PROCESSING',
    'READY_FOR_SHIPMENT','SHIPPED','DELIVERED','CANCELLED','DISPUTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SEQUENCE IF NOT EXISTS public.purchase_orders_number_seq START 1;

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number                  TEXT NOT NULL UNIQUE,
  buyer_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status                  public.purchase_order_status NOT NULL DEFAULT 'SUBMITTED',
  buyer_comment           TEXT,
  supplier_comment        TEXT,
  rejection_reason        TEXT,
  delivery_method         TEXT NOT NULL DEFAULT 'delivery'
                            CHECK (delivery_method IN ('delivery','pickup')),
  delivery_address        TEXT,
  requested_delivery_date DATE,
  promised_shipment_date  DATE,
  subtotal                INTEGER NOT NULL DEFAULT 0,  -- копейки, серверный расчёт
  confirmed_subtotal      INTEGER,                     -- сумма по согласованным количествам (после confirm)
  currency                TEXT NOT NULL DEFAULT 'RUB',
  source_order_id         TEXT,                         -- заказ кондитера, под который закупка (nullable)
  idempotency_key         UUID,                         -- защита от двойного создания
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at            TIMESTAMPTZ,
  rejected_at             TIMESTAMPTZ,
  shipped_at              TIMESTAMPTZ,
  delivered_at            TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ
);

-- Колонка для уже созданных ранее таблиц (идемпотентное обновление схемы).
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS confirmed_subtotal INTEGER;

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES public.supplier_products(id),
  product_name       TEXT NOT NULL,   -- snapshot на момент заказа
  unit               TEXT NOT NULL,   -- snapshot
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  confirmed_quantity INTEGER,         -- согласованная поставщиком (<= reserved)
  unit_price         INTEGER NOT NULL, -- snapshot, копейки
  line_total         INTEGER NOT NULL, -- копейки
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  changed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_role TEXT,
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK журнала движений на закупочные заказы (таблица теперь существует).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_movements_order_fk'
  ) THEN
    ALTER TABLE public.supplier_product_movements
      ADD CONSTRAINT supplier_movements_order_fk
        FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_buyer   ON public.purchase_orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON public.purchase_orders (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status   ON public.purchase_orders (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_idempotency
  ON public.purchase_orders (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_items_order ON public.purchase_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_po_history_order ON public.purchase_order_status_history (order_id, created_at DESC);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_orders_select_parties" ON public.purchase_orders;
CREATE POLICY "purchase_orders_select_parties" ON public.purchase_orders
  FOR SELECT USING (
    buyer_id = auth.uid()
    OR supplier_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN','SUPER_ADMIN','SUPPORT') AND ur.is_active = true)
  );

DROP POLICY IF EXISTS "purchase_order_items_select_parties" ON public.purchase_order_items;
CREATE POLICY "purchase_order_items_select_parties" ON public.purchase_order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.id = purchase_order_items.order_id
        AND (po.buyer_id = auth.uid()
          OR po.supplier_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('ADMIN','SUPER_ADMIN','SUPPORT') AND ur.is_active = true))
    )
  );

DROP POLICY IF EXISTS "purchase_order_history_select_parties" ON public.purchase_order_status_history;
CREATE POLICY "purchase_order_history_select_parties" ON public.purchase_order_status_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.id = purchase_order_status_history.order_id
        AND (po.buyer_id = auth.uid()
          OR po.supplier_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('ADMIN','SUPER_ADMIN','SUPPORT') AND ur.is_active = true))
    )
  );

-- Мутации purchase_orders/items/history — только service role (серверные API);
-- политики INSERT/UPDATE/DELETE для authenticated не создаются (deny by default).
