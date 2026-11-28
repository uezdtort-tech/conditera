-- 0063_cake_project_spec.sql
-- Расширение конструктора до сохраняемого проекта изделия, а не только
-- набора полей для торта. Все денежные значения inquiry хранятся в копейках.

BEGIN;

ALTER TABLE public.cake_builder_drafts
  ADD COLUMN IF NOT EXISTS product_type TEXT,
  ADD COLUMN IF NOT EXISTS tiers INTEGER,
  ADD COLUMN IF NOT EXISTS shape TEXT,
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS project_spec JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS product_type TEXT,
  ADD COLUMN IF NOT EXISTS tiers INTEGER,
  ADD COLUMN IF NOT EXISTS shape TEXT,
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS estimated_delivery_cost INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS project_spec JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cake_builder_drafts_quantity_range') THEN
    ALTER TABLE public.cake_builder_drafts
      ADD CONSTRAINT cake_builder_drafts_quantity_range CHECK (quantity BETWEEN 1 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cake_builder_drafts_tiers_range') THEN
    ALTER TABLE public.cake_builder_drafts
      ADD CONSTRAINT cake_builder_drafts_tiers_range CHECK (tiers IS NULL OR tiers BETWEEN 1 AND 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_quantity_range') THEN
    ALTER TABLE public.inquiries
      ADD CONSTRAINT inquiries_quantity_range CHECK (quantity BETWEEN 1 AND 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_tiers_range') THEN
    ALTER TABLE public.inquiries
      ADD CONSTRAINT inquiries_tiers_range CHECK (tiers IS NULL OR tiers BETWEEN 1 AND 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_estimated_delivery_cost_nonnegative') THEN
    ALTER TABLE public.inquiries
      ADD CONSTRAINT inquiries_estimated_delivery_cost_nonnegative CHECK (estimated_delivery_cost >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inquiries_project_city
  ON public.inquiries (city, product_type, status, submitted_at DESC);

COMMENT ON COLUMN public.inquiries.estimated_price IS 'Предварительная стоимость изделия в копейках; окончательная цена устанавливается в переговорах';
COMMENT ON COLUMN public.inquiries.estimated_delivery_cost IS 'Предварительная стоимость доставки в копейках';
COMMENT ON COLUMN public.inquiries.project_spec IS 'Полный неизменяемый snapshot параметров проекта на момент отправки';
COMMENT ON COLUMN public.cake_builder_drafts.project_spec IS 'Текущий snapshot параметров проекта конструктора';

COMMIT;