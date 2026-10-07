-- 0054_order_lifecycle_capacity.sql — P0.5 «Order Lifecycle & Capacity Engine».
--
-- Принципы ТЗ P0.5:
--   • НЕ создаём параллельную систему заказов — используем существующие
--     orders/order_status/payment_status (бизнес/платёжный статус РАЗДЕЛЕНЫ
--     уже на уровне enum'ов 0001) и добавляем только то, чего нет:
--       1) confectioner_capacity        — производственная конфигурация кондитера
--       2) capacity_reservations        — резерв производственной мощности (окно)
--       3) order_production             — lifecycle-метаданные заказа (оценка времени,
--                                         latest safe start, риск, фото-гейт)
--       4) order_production_checklist   — производственный чеклист заказа
--       5) order_media                  — фото готовности (reuses product-media storage)
--       6) purchase_drafts.expected_eta — ETA закупки для Acceptance Engine (ТЗ §20)
--
-- Идемпотентно (IF NOT EXISTS / DO $$ guard), forward-only, RLS по образцу 0053:
-- SELECT для authenticated, запись — только service role (getPool()).
--
-- Конкурентность (ТЗ §27): пересечение окон одного кондитера запрещено
-- EXCLUDE-констрейнтом (btree_gist) на уровне БД — два параллельных INSERT
-- не могут зарезервировать пересекающиеся интервалы.

-- ============================================================================
-- 0. Расширение для EXCLUDE-констрейнта
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================================
-- 1. confectioner_capacity — производственная конфигурация кондитера
--    (окно рабочего дня и дневная ёмкость; NULL → глобальные дефолты из
--     src/lib/ops/lifecycle-config.ts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.confectioner_capacity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workday_start_minute integer,           -- минута дня, напр. 540 = 09:00
  workday_end_minute integer,             -- напр. 1080 = 18:00
  daily_capacity_minutes integer,         -- суммарная производственная ёмкость/день
  packaging_minutes integer,              -- буфер упаковки (ТЗ §11)
  quality_check_minutes integer,          -- QC перед готовностью
  handoff_buffer_minutes integer,         -- буфер передачи (ТЗ §11, §34)
  delivery_buffer_minutes integer,        -- буфер доставки (ТЗ §11)
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.confectioner_capacity IS 'Производственная конфигурация кондитера (P0.5 Capacity Engine); NULL → глобальные дефолты';

ALTER TABLE public.confectioner_capacity ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'confectioner_capacity' AND policyname = 'confectioner_capacity_select') THEN
    CREATE POLICY confectioner_capacity_select ON public.confectioner_capacity
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- 2. capacity_reservations — резерв производственного окна (ТЗ §28)
--    status: reserved → confirmed → released | cancelled
--    EXCLUDE: у одного кондитера на одну дату интервалы [start_minute, end_minute)
--    не пересекаются среди активных (reserved|confirmed) резервов.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.capacity_reservations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  confectioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reserved_date date NOT NULL,
  start_minute integer NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute integer NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440 AND end_minute > start_minute),
  estimated_minutes integer NOT NULL CHECK (estimated_minutes > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','confirmed','released','cancelled')),
  created_by uuid,                         -- кто зарезервировал (audit, ТЗ §44)
  released_at timestamptz,
  released_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_capacity_reservation_span CHECK (end_minute - start_minute <= 1440)
);

COMMENT ON TABLE public.capacity_reservations IS 'Резервы производственной мощности кондитера (P0.5); пересечение активных окон запрещено EXCLUDE';

CREATE INDEX IF NOT EXISTS idx_capacity_reservations_conf_date
  ON public.capacity_reservations (confectioner_id, reserved_date) WHERE status IN ('reserved','confirmed');
CREATE INDEX IF NOT EXISTS idx_capacity_reservations_order
  ON public.capacity_reservations (order_id);

-- Активных резервов на заказ — не более одного (переназначение = release + new)
CREATE UNIQUE INDEX IF NOT EXISTS uq_capacity_reservations_order_active
  ON public.capacity_reservations (order_id) WHERE status IN ('reserved','confirmed');

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excl_capacity_reservations_overlap'
  ) THEN
    ALTER TABLE public.capacity_reservations ADD CONSTRAINT excl_capacity_reservations_overlap
      EXCLUDE USING gist (
        confectioner_id WITH =,
        reserved_date WITH =,
        int8range(start_minute, end_minute) WITH &&
      ) WHERE (status IN ('reserved','confirmed'));
  END IF;
END $$;

ALTER TABLE public.capacity_reservations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'capacity_reservations' AND policyname = 'capacity_reservations_select') THEN
    CREATE POLICY capacity_reservations_select ON public.capacity_reservations
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- 3. order_production — lifecycle-метаданные заказа (ТЗ §42 «lifecycle metadata»)
--    Оценка времени производства, latest safe start, риск, флаг фото готовности.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_production (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  estimated_minutes integer CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  estimate_source text NOT NULL DEFAULT 'default', -- product|recipe|category|manual|default
  estimate_is_approximate boolean NOT NULL DEFAULT true, -- ТЗ §10: estimated vs configured
  latest_safe_start_at timestamptz,       -- Deadline Engine (ТЗ §11)
  deadline_at timestamptz,                -- «дедлайн клиента» в момент расчёта
  planned_start_minute integer,           -- план производства (минута дня reserved_date)
  planned_date date,                      -- дата плана производства (= reserved_date)
  risk_level text NOT NULL DEFAULT 'GREEN' CHECK (risk_level IN ('GREEN','YELLOW','ORANGE','RED')),
  risk_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_calculated_at timestamptz,
  started_at timestamptz,                 -- фактический старт производства
  completed_at timestamptz,               -- производство завершено (QC пройден)
  ready_photo_required boolean NOT NULL DEFAULT false, -- ТЗ §35
  photo_attached_at timestamptz,
  checklist_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.order_production IS 'P0.5 lifecycle-метаданные заказа: оценка времени, latest safe start, риск, фото-гейт';

CREATE INDEX IF NOT EXISTS idx_order_production_risk
  ON public.order_production (risk_level) WHERE risk_level IN ('ORANGE','RED');

ALTER TABLE public.order_production ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_production' AND policyname = 'order_production_select') THEN
    CREATE POLICY order_production_select ON public.order_production
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- 4. order_production_checklist — производственный чеклист заказа (ТЗ §17-18)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_production_checklist (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  stage_key text NOT NULL,                 -- ingredients_prepared|baking|cooling|filling|assembly|decoration|quality_check|packaging|ready_photo|handoff
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_order_checklist_stage UNIQUE (order_id, stage_key)
);

COMMENT ON TABLE public.order_production_checklist IS 'Производственный чеклист заказа (этапы зависят от типа продукта, ТЗ §18)';

CREATE INDEX IF NOT EXISTS idx_order_checklist_order ON public.order_production_checklist (order_id, sort_order);

ALTER TABLE public.order_production_checklist ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_production_checklist' AND policyname = 'order_production_checklist_select') THEN
    CREATE POLICY order_production_checklist_select ON public.order_production_checklist
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- 5. order_media — фото готовности заказа (ТЗ §35)
--    Reuses product-media инфраструктуру (storage/validation libs, паттерн 0052):
--    файл в локальном FS (storage/orders/<orderId>/published/photos/<uuid>.<ext>),
--    метаданные — здесь. Статус сразу 'approved' — это внутренний QC-артефакт,
--    НЕ витринный контент (в очереди модерации не участвует).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_media (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'ready_photo', -- ready_photo | handoff_photo
  media_type text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo')),
  storage_path text NOT NULL,              -- относительный путь от storage root
  original_filename text,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  width integer,
  height integer,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.order_media IS 'Фото готовности/передачи заказа (P0.5 §35; переиспользует product-media storage)';

CREATE INDEX IF NOT EXISTS idx_order_media_order ON public.order_media (order_id, kind) WHERE status = 'approved';

ALTER TABLE public.order_media ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_media' AND policyname = 'order_media_select') THEN
    CREATE POLICY order_media_select ON public.order_media
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================================
-- 6. purchase_drafts.expected_eta — ETA закупки (ТЗ §20 Procurement integration)
-- ============================================================================
ALTER TABLE public.purchase_drafts ADD COLUMN IF NOT EXISTS expected_eta timestamptz;
COMMENT ON COLUMN public.purchase_drafts.expected_eta IS 'Ожидаемое время поставки (Acceptance Engine: ETA vs deadline, ТЗ P0.5 §20)';

-- ============================================================================
-- 7. updated_at-триггеры (общий хендлер из 0002)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_marketplace_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_confectioner_capacity_updated_at ON public.confectioner_capacity;
    CREATE TRIGGER trg_confectioner_capacity_updated_at BEFORE UPDATE ON public.confectioner_capacity
      FOR EACH ROW EXECUTE FUNCTION handle_marketplace_updated_at();

    DROP TRIGGER IF EXISTS trg_capacity_reservations_updated_at ON public.capacity_reservations;
    CREATE TRIGGER trg_capacity_reservations_updated_at BEFORE UPDATE ON public.capacity_reservations
      FOR EACH ROW EXECUTE FUNCTION handle_marketplace_updated_at();

    DROP TRIGGER IF EXISTS trg_order_production_updated_at ON public.order_production;
    CREATE TRIGGER trg_order_production_updated_at BEFORE UPDATE ON public.order_production
      FOR EACH ROW EXECUTE FUNCTION handle_marketplace_updated_at();

    DROP TRIGGER IF EXISTS trg_order_media_updated_at ON public.order_media;
    CREATE TRIGGER trg_order_media_updated_at BEFORE UPDATE ON public.order_media
      FOR EACH ROW EXECUTE FUNCTION handle_marketplace_updated_at();
  END IF;
END $$;
