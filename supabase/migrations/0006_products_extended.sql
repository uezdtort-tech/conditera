-- ====================================================================
-- 0006_products_extended.sql — Расширение marketplace: видео, варианты, трекинг
-- ====================================================================

-- ===== 1. Product Videos =====
CREATE TABLE IF NOT EXISTS public.product_videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  poster_url TEXT,
  title TEXT,
  description TEXT,
  duration_seconds INTEGER,
  is_primary BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing', -- processing|ready|failed
  views_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.product_videos IS 'Видео в карточках товаров';
CREATE INDEX idx_product_videos_product ON public.product_videos(product_id);
CREATE INDEX idx_product_videos_primary ON public.product_videos(product_id) WHERE is_primary = TRUE;

-- ===== 2. Product Variants (вес, размер, вкус) =====
CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- '1 кг' | '2 кг' | 'Большой'
  weight_grams INTEGER,
  price_modifier INTEGER DEFAULT 0, -- в копейках
  sku TEXT,
  in_stock BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.product_variants IS 'Варианты товаров (вес, размер)';
CREATE INDEX idx_product_variants_product ON public.product_variants(product_id);
CREATE INDEX idx_product_variants_default ON public.product_variants(product_id) WHERE is_default = TRUE;

-- ===== 3. Order Status History =====
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status_from TEXT,
  status_to TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.order_status_history IS 'История изменения статуса заказа';
CREATE INDEX idx_order_status_history_order ON public.order_status_history(order_id);

-- ===== 4. Delivery Tracking (геолокация курьера в realtime) =====
CREATE TABLE IF NOT EXISTS public.delivery_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_id UUID REFERENCES public.deliveries(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  courier_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  heading DECIMAL(5, 2),
  speed DECIMAL(5, 2),
  status TEXT, -- 'picked_up' | 'on_the_way' | 'arrived' | 'delivered' | 'failed'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.delivery_tracking IS 'Геолокация курьера в realtime';
CREATE INDEX idx_delivery_tracking_delivery ON public.delivery_tracking(delivery_id);
CREATE INDEX idx_delivery_tracking_order ON public.delivery_tracking(order_id);
CREATE INDEX idx_delivery_tracking_created ON public.delivery_tracking(order_id, created_at DESC);

-- ===== 5. Repeat Order Templates =====
CREATE TABLE IF NOT EXISTS public.repeat_order_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  name TEXT, -- 'Торт на день рождения Маши'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.repeat_order_templates IS 'Шаблоны повторных заказов';
CREATE INDEX idx_repeat_templates_user ON public.repeat_order_templates(user_id);

-- ===== 6. Favorite Confectioners (избранные кондитеры) =====
CREATE TABLE IF NOT EXISTS public.favorite_confectioners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confectioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, confectioner_id)
);

COMMENT ON TABLE public.favorite_confectioners IS 'Избранные кондитеры пользователя';
CREATE INDEX idx_fav_confectioners_user ON public.favorite_confectioners(user_id);

-- ===== 7. RLS =====

-- product_videos: public read, confectioner write
ALTER TABLE public.product_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_videos_select_public" ON public.product_videos
  FOR SELECT USING (TRUE);
CREATE POLICY "product_videos_write_owner" ON public.product_videos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.confectioner_id = auth.uid())
  );

-- product_variants: public read, confectioner write
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_variants_select_public" ON public.product_variants
  FOR SELECT USING (TRUE);
CREATE POLICY "product_variants_write_owner" ON public.product_variants
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.confectioner_id = auth.uid())
  );

-- order_status_history: через order_id
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_history_select" ON public.order_status_history
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND (
              o.user_id = auth.uid() OR o.confectioner_id = auth.uid() OR
              EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
                      AND ur.role IN ('ADMIN','SUPER_ADMIN','SUPPORT') AND ur.is_active)
            ))
  );
CREATE POLICY "order_history_insert" ON public.order_status_history
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND (
              o.user_id = auth.uid() OR o.confectioner_id = auth.uid() OR
              EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
                      AND ur.role IN ('ADMIN','SUPER_ADMIN','COURIER') AND ur.is_active)
            ))
  );

-- delivery_tracking: courier + order participants
ALTER TABLE public.delivery_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delivery_tracking_select" ON public.delivery_tracking
  FOR SELECT USING (
    auth.uid() = courier_id OR
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (
      o.user_id = auth.uid() OR o.confectioner_id = auth.uid() OR
      EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
              AND ur.role IN ('ADMIN','SUPER_ADMIN') AND ur.is_active)
    ))
  );
CREATE POLICY "delivery_tracking_insert_courier" ON public.delivery_tracking
  FOR INSERT WITH CHECK (auth.uid() = courier_id);

-- repeat_order_templates: only own
ALTER TABLE public.repeat_order_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "repeat_templates_own" ON public.repeat_order_templates
  FOR ALL USING (auth.uid() = user_id);

-- favorite_confectioners: only own
ALTER TABLE public.favorite_confectioners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fav_confectioners_own" ON public.favorite_confectioners
  FOR ALL USING (auth.uid() = user_id);

-- ===== 8. Triggers =====
CREATE TRIGGER product_videos_updated_at
  BEFORE UPDATE ON public.product_videos
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

CREATE TRIGGER product_variants_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_updated_at();

-- Auto-log status change on order update
CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_status_history (order_id, status_from, status_to, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER orders_log_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();

-- ===== Permissions =====
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.product_videos, public.product_variants,
  public.order_status_history, public.delivery_tracking,
  public.repeat_order_templates, public.favorite_confectioners
TO authenticated;
