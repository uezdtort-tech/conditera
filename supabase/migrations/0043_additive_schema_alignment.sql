-- 0043_additive_schema_alignment.sql
--
-- Выравнивание схемы с кодом API: колонки, на которые опираются реальные
-- маршруты (products/[id]/slice-3d-config, fillings/[id]/slice, moderator/queue,
-- operator/messages и др.), но которых не было ни в одной миграции.
-- Всё ADDITIVE (nullable / с дефолтами) — ни одна существующая строка не меняется.
--
-- Каждый блок сопровождён маршрутом-потребителем.

-- ===== fillings: карточка разреза (сценарий «карточка товара») =====
-- consumer: src/app/api/fillings/[id]/slice/route.ts, moderator/queue
ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS consistency text;
ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS allergens text[] DEFAULT '{}';
ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS slice_image text;
ALTER TABLE public.fillings ADD COLUMN IF NOT EXISTS slice_config jsonb DEFAULT '{}'::jsonb;

-- ===== products: 3D-конфигурация разреза =====
-- consumer: src/app/api/products/[id]/slice-3d-config/route.ts
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS fillings jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS model_url text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS model_usdz_url text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ar_enabled boolean DEFAULT false;

-- ===== reviews: модерация =====
-- consumer: src/app/api/moderator/queue/route.ts (pending/approved/rejected)
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
-- существующие отзывы считаются одобренными — дефолт 'approved' покрывает их

-- ===== operator_escalations: эскалация из чата к оператору поддержки =====
-- consumer: src/app/api/operator/messages/route.ts
-- (room_id/user_* — ветка чат-эскалаций; ticket_id/operator_id — тикетная, обе живут)
ALTER TABLE public.operator_escalations
  ADD COLUMN IF NOT EXISTS room_id uuid,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS user_name text,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ===== Индексы под новые пути =====
CREATE INDEX IF NOT EXISTS idx_fillings_category ON public.fillings(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_status ON public.reviews(status);
CREATE INDEX IF NOT EXISTS idx_operator_escalations_room ON public.operator_escalations(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operator_escalations_user ON public.operator_escalations(user_id) WHERE user_id IS NOT NULL;
