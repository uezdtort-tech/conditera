-- ============================================================================
-- 0057_order_reviews.sql — привязка отзывов к заказам + фото отзыва (P1 §15).
--
-- Зачем: отзыв после доставки/завершения заказа (кабинет клиента, ТЗ §15).
-- Отзыв создаётся из карточки заказа: нужен порядок «один заказ → один
-- отзыв» (проверка по order_id на уровне API + индекс) и возможность
-- приложить до 3 фото (JSONB-массив URL из /api/upload).
--
-- Идемпотентно: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- ============================================================================

-- Связь отзыва с заказом (NULL — отзыв, оставленный вне контекста заказа)
ALTER TABLE public.product_reviews
  ADD COLUMN IF NOT EXISTS order_id UUID NULL REFERENCES public.orders(id) ON DELETE SET NULL;

-- Фото отзыва: массив URL (≤3, контроль количества на уровне API)
ALTER TABLE public.product_reviews
  ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb;

-- Поиск отзыва по заказу (ONE order → ONE review)
CREATE INDEX IF NOT EXISTS idx_reviews_order ON public.product_reviews(order_id);

COMMENT ON COLUMN public.product_reviews.order_id IS 'Заказ, к которому относится отзыв (NULL — отзыв вне заказа)';
COMMENT ON COLUMN public.product_reviews.photos IS 'Фото отзыва: JSONB-массив URL (≤3), URL из /api/upload';
