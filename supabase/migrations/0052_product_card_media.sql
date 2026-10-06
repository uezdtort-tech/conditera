-- 0052_product_card_media.sql
--
-- Медиа карточки товара (Task 2-a, ветка feat/product-card-media):
--
--   A) public.product_media — единая таблица фото/видео товара
--      (загрузка кондитером → модерация → публикация в карточке):
--        - лимиты на уровне БД: ≤10 фото и ≤3 видео на товар
--          (rejected-строки не считаются), триггер BEFORE INSERT;
--        - одна обложка-фото на товар (частичный уникальный индекс);
--        - RLS по образцу product_images (0002:353) / product_videos (0006:105):
--          публично видны только approved, запись — владелец товара, модерация —
--          админ/moderator; service_role полный доступ (BYPASSRLS, compat 0000:41);
--        - updated_at — стандартный public.handle_marketplace_updated_at() (0002:498).
--
--   B) расширение public.products полями карточки (только ADD COLUMN IF NOT EXISTS,
--      ничего не удаляем и не переименовываем).

-- ====================================================================
-- A. Таблица product_media
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.product_media (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('photo','video')),
  storage_path text NOT NULL,
  original_filename text,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  width integer,
  height integer,
  duration_seconds integer,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  is_cover boolean NOT NULL DEFAULT false,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  moderated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  moderated_at timestamptz,
  moderation_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_media IS 'Медиа карточки товара: фото и видео с модерацией (pending|approved|rejected)';

-- Выдача в карточку товара: фильтр по товару + тип + статус, порядок = sort_order
CREATE INDEX IF NOT EXISTS idx_product_media_list
  ON public.product_media (product_id, media_type, status, sort_order);

-- Очередь модерации: свежие непромодерированные первыми
CREATE INDEX IF NOT EXISTS idx_product_media_status
  ON public.product_media (status, uploaded_at DESC);

-- Ровно одна обложка-фото на товар
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_media_cover
  ON public.product_media (product_id)
  WHERE is_cover = true AND media_type = 'photo';

-- --------------------------------------------------------------------
-- Лимиты медиа на товар (жёсткая гарантия на уровне БД):
-- не более 10 фото и 3 видео в живых статусах (pending/approved).
-- Приложение может ошибаться — БД не даст.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_product_media_limit()
RETURNS trigger AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.product_media
  WHERE product_id = NEW.product_id
    AND media_type = NEW.media_type
    AND status <> 'rejected';

  IF NEW.media_type = 'photo' AND v_count >= 10 THEN
    RAISE EXCEPTION 'PHOTO_LIMIT_REACHED'
      USING ERRCODE = 'P0001',
            DETAIL = format('product %s: %s live photo(s) (rejected не считаются)', NEW.product_id, v_count);
  END IF;

  IF NEW.media_type = 'video' AND v_count >= 3 THEN
    RAISE EXCEPTION 'VIDEO_LIMIT_REACHED'
      USING ERRCODE = 'P0001',
            DETAIL = format('product %s: %s live video(s) (rejected не считаются)', NEW.product_id, v_count);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_media_limit ON public.product_media;
CREATE TRIGGER trg_product_media_limit
  BEFORE INSERT ON public.product_media
  FOR EACH ROW EXECUTE FUNCTION public.fn_product_media_limit();

-- updated_at: общий механизм маркетплейса (0002:498), как у products/product_reviews
DROP TRIGGER IF EXISTS trg_product_media_updated_at ON public.product_media;
CREATE TRIGGER trg_product_media_updated_at
  BEFORE UPDATE ON public.product_media
  FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_updated_at();

-- --------------------------------------------------------------------
-- RLS: по образцу product_images (0002:353) и product_videos (0006:105).
-- Гость видит только approved; владелец товара видит и управляет своими
-- строками (в т.ч. pending — иначе очередь «Мои загрузки» пуста);
-- модерация — ADMIN/SUPER_ADMIN/MODERATOR (как products_admin_all 0002:345).
-- service_role обходит RLS всегда (BYPASSRLS, compat 0000:40-41).
-- --------------------------------------------------------------------
ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_media_select_public" ON public.product_media;
CREATE POLICY "product_media_select_public" ON public.product_media
  FOR SELECT USING (
    status = 'approved'
    OR EXISTS (SELECT 1 FROM public.products p
               WHERE p.id = product_id AND p.confectioner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles ur
               WHERE ur.user_id = auth.uid()
                 AND ur.role IN ('ADMIN','SUPER_ADMIN','MODERATOR')
                 AND ur.is_active = TRUE)
  );

DROP POLICY IF EXISTS "product_media_insert_own" ON public.product_media;
CREATE POLICY "product_media_insert_own" ON public.product_media
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.confectioner_id = auth.uid())
  );

DROP POLICY IF EXISTS "product_media_update_own" ON public.product_media;
CREATE POLICY "product_media_update_own" ON public.product_media
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.confectioner_id = auth.uid())
  );

DROP POLICY IF EXISTS "product_media_delete_own" ON public.product_media;
CREATE POLICY "product_media_delete_own" ON public.product_media
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.confectioner_id = auth.uid())
  );

-- Модерация: смена status/moderated_by/moderation_comment
DROP POLICY IF EXISTS "product_media_moderate" ON public.product_media;
CREATE POLICY "product_media_moderate" ON public.product_media
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('ADMIN','SUPER_ADMIN','MODERATOR')
              AND ur.is_active = TRUE)
  );

-- ====================================================================
-- B. Расширение products (только ADD COLUMN IF NOT EXISTS)
-- ====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS diameter_cm numeric(6,2),
  ADD COLUMN IF NOT EXISTS height_cm numeric(6,2),
  ADD COLUMN IF NOT EXISTS size_text text,
  ADD COLUMN IF NOT EXISTS shape text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS filling_description text,
  ADD COLUMN IF NOT EXISTS layers_count integer,
  ADD COLUMN IF NOT EXISTS composition jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recipe_id uuid REFERENCES public.recipes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS min_order_qty integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS custom_order_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS production_time_hours integer;

-- Единицы измерения и семантика полей карточки
COMMENT ON COLUMN public.products.short_description IS 'Короткое описание для карточки/листинга (1-2 предложения)';
COMMENT ON COLUMN public.products.diameter_cm IS 'Диаметр изделия, см';
COMMENT ON COLUMN public.products.height_cm IS 'Высота изделия, см';
COMMENT ON COLUMN public.products.size_text IS 'Размер в свободной форме (текст), напр. «20×30 см»';
COMMENT ON COLUMN public.products.shape IS 'Форма изделия (round/square/heart/... или свободный текст)';
COMMENT ON COLUMN public.products.product_type IS 'Тип изделия (cake/cupcake/cookies/...)';
COMMENT ON COLUMN public.products.filling_description IS 'Описание начинок в свободной форме (кроме структурированной composition)';
COMMENT ON COLUMN public.products.layers_count IS 'Количество ярусов/слоёв';
COMMENT ON COLUMN public.products.composition IS 'Состав: ингредиенты, аллергены, КБЖУ, хранение (структурированный jsonb)';
COMMENT ON COLUMN public.products.recipe_id IS 'Связанный рецепт из public.recipes (обнуляется при удалении рецепта)';
COMMENT ON COLUMN public.products.min_order_qty IS 'Минимальный заказ, шт (по умолчанию 1)';
COMMENT ON COLUMN public.products.custom_order_available IS 'Доступен индивидуальный заказ на основе этого изделия';
COMMENT ON COLUMN public.products.is_available IS 'Изделие доступно к заказу сейчас (временное скрытие без снятия с публикации)';
COMMENT ON COLUMN public.products.production_time_hours IS 'Срок изготовления, часы (от заказа до выдачи)';
COMMENT ON COLUMN public.products.weight_grams IS 'Вес изделия, г (см. 0002)';
