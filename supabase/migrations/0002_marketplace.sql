-- ====================================================================
-- 0002_marketplace.sql — Маркетплейс: товары, корзина, заказы, платежи
-- ====================================================================
-- Создаёт таблицы:
--   1. product_categories — категории (28 категорий из ТЗ)
--   2. products — товары
--   3. product_images — изображения
--   4. product_attributes — атрибуты (вес, размер, вкус)
--   5. product_reviews — отзывы
--   6. product_favorites — избранное (wishlist)
--   7. cart_items — корзина (анонимная + для залогиненных)
--   8. orders — заказы
--   9. order_items — позиции заказа (snapshot цены)
--   10. payments — платежи Yookassa
--   11. deliveries — доставки
--
-- Все таблицы с user data имеют RLS политики.
-- ====================================================================

-- ===== 1. Product Categories =====
CREATE TABLE IF NOT EXISTS public.product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  parent_id UUID REFERENCES public.product_categories(id) ON DELETE SET NULL,
  group_name TEXT DEFAULT 'Кондитерские изделия', -- 'Кондитерские изделия' | 'Сопутствующие товары'
  link TEXT, -- для сопутствующих: 'decor-shop', 'supplier-shop', etc.
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.product_categories IS 'Категории товаров (28 шт: 20 кондитерских + 8 сопутствующих)';
CREATE INDEX idx_categories_slug ON public.product_categories(slug);
CREATE INDEX idx_categories_parent ON public.product_categories(parent_id);

-- ===== 2. Products =====
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  confectioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.product_categories(id) ON DELETE SET NULL,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  long_description TEXT,
  price INTEGER NOT NULL, -- в копейках (для избежания float)
  old_price INTEGER, -- для скидок
  currency TEXT DEFAULT 'RUB',
  weight_grams INTEGER, -- вес в граммах
  servings INTEGER, -- на сколько человек
  -- Категориальные теги
  tags TEXT[] DEFAULT '{}',
  dietary_features TEXT[] DEFAULT '{}', -- ['gluten_free', 'vegan', 'keto', 'halal', 'kosher']
  -- Статус
  status TEXT DEFAULT 'draft', -- 'draft' | 'published' | 'archived' | 'blocked'
  is_featured BOOLEAN DEFAULT FALSE, -- показывать на главной
  -- Метрики
  views_count INTEGER DEFAULT 0,
  sales_count INTEGER DEFAULT 0,
  rating_average DECIMAL(3, 2) DEFAULT 0,
  reviews_count INTEGER DEFAULT 0,
  -- Timestamps
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE public.products IS 'Товары кондитеров';
CREATE INDEX idx_products_confectioner ON public.products(confectioner_id);
CREATE INDEX idx_products_category ON public.products(category_id);
CREATE INDEX idx_products_status ON public.products(status) WHERE status = 'published';
CREATE INDEX idx_products_featured ON public.products(is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_products_price ON public.products(price);
CREATE INDEX idx_products_tags ON public.products USING GIN(tags);
CREATE INDEX idx_products_dietary ON public.products USING GIN(dietary_features);
-- Full Text Search
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_products_search ON public.products USING GIN(search_vector);
-- Trigram для поиска с опечатками
CREATE INDEX IF NOT EXISTS idx_products_title_trgm ON public.products USING GIN(title gin_trgm_ops);

-- ===== 3. Product Images =====
CREATE TABLE IF NOT EXISTS public.product_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt_text TEXT,
  sort_order INTEGER DEFAULT 0,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.product_images IS 'Изображения товаров (множественные)';
CREATE INDEX idx_product_images_product ON public.product_images(product_id);
CREATE INDEX idx_product_images_primary ON public.product_images(product_id) WHERE is_primary = TRUE;

-- ===== 4. Product Attributes =====
CREATE TABLE IF NOT EXISTS public.product_attributes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- 'Вес', 'Размер', 'Вкус'
  value TEXT NOT NULL, -- '1 кг', 'Большой', 'Шоколад'
  price_modifier INTEGER DEFAULT 0, -- в копейках
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.product_attributes IS 'Атрибуты товара (вес, размер, вкус и т.д.)';
CREATE INDEX idx_product_attributes_product ON public.product_attributes(product_id);

-- ===== 5. Product Reviews =====
CREATE TABLE IF NOT EXISTS public.product_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  text TEXT,
  pros TEXT, -- плюсы
  cons TEXT, -- минусы
  -- Статус модерации
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'flagged'
  moderated_by UUID REFERENCES auth.users(id),
  moderated_at TIMESTAMPTZ,
  -- Полезность отзыва
  helpful_count INTEGER DEFAULT 0,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, user_id) -- один отзыв на товар от одного пользователя
);

COMMENT ON TABLE public.product_reviews IS 'Отзывы на товары (1-5 звёзд)';
CREATE INDEX idx_reviews_product ON public.product_reviews(product_id);
CREATE INDEX idx_reviews_user ON public.product_reviews(user_id);
CREATE INDEX idx_reviews_status ON public.product_reviews(status) WHERE status = 'approved';

-- ===== 6. Product Favorites (Wishlist) =====
CREATE TABLE IF NOT EXISTS public.product_favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);

COMMENT ON TABLE public.product_favorites IS 'Избранное (wishlist)';
CREATE INDEX idx_favorites_user ON public.product_favorites(user_id);
CREATE INDEX idx_favorites_product ON public.product_favorites(product_id);

-- ===== 7. Cart Items =====
-- ВАЖНО: cart может быть анонимной (через session_id) или привязанной к user
CREATE TABLE IF NOT EXISTS public.cart_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- может быть null для анонимов
  session_id TEXT, -- для анонимных корзин (cookie)
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  selected_attributes JSONB, -- выбранные атрибуты с price_modifier
  notes TEXT, -- комментарий к позиции
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT cart_owner_check CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

COMMENT ON TABLE public.cart_items IS 'Корзина (работает для залогиненных и анонимов)';
CREATE INDEX idx_cart_user ON public.cart_items(user_id);
CREATE INDEX idx_cart_session ON public.cart_items(session_id);
CREATE INDEX idx_cart_product ON public.cart_items(product_id);

-- ===== 8. Orders =====
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  number TEXT UNIQUE NOT NULL, -- 'ORD-2026-0001'
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  confectioner_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- Суммы (в копейках)
  subtotal INTEGER NOT NULL, -- сумма позиций
  delivery_cost INTEGER DEFAULT 0,
  discount INTEGER DEFAULT 0,
  total INTEGER NOT NULL, -- subtotal + delivery - discount
  -- Статус
  status order_status DEFAULT 'PENDING',
  -- Тип заказа
  type TEXT DEFAULT 'product', -- 'product' | 'cake_builder' | 'subscription'
  -- Адрес доставки
  delivery_address TEXT,
  delivery_city TEXT,
  delivery_postal_code TEXT,
  delivery_lat DECIMAL(10, 7),
  delivery_lng DECIMAL(10, 7),
  delivery_type TEXT DEFAULT 'delivery', -- 'delivery' | 'pickup' | 'self_pickup'
  delivery_date DATE,
  delivery_time_window TEXT, -- '10:00-14:00'
  -- Дополнительно
  notes TEXT,
  metadata JSONB,
  -- Timestamps
  confirmed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.orders IS 'Заказы';
CREATE INDEX idx_orders_user ON public.orders(user_id);
CREATE INDEX idx_orders_confectioner ON public.orders(confectioner_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_number ON public.orders(number);
CREATE INDEX idx_orders_created ON public.orders(created_at DESC);

-- ===== 9. Order Items =====
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  -- Snapshot данных товара на момент заказа
  product_title TEXT NOT NULL,
  product_image TEXT,
  -- Snapshot цены
  unit_price INTEGER NOT NULL, -- в копейках
  quantity INTEGER NOT NULL DEFAULT 1,
  -- Snapshot атрибутов
  selected_attributes JSONB,
  -- Итог
  total INTEGER NOT NULL, -- unit_price * quantity
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.order_items IS 'Позиции заказа (snapshot цены)';
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_order_items_product ON public.order_items(product_id);

-- ===== 10. Payments =====
-- Тип метода оплаты (используется таблицей payments ниже)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE payment_method AS ENUM ('card', 'sbp', 'cash', 'split', 'installment', 'yookassa', 'self');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- Yookassa
  yookassa_payment_id TEXT UNIQUE,
  yookassa_status TEXT, -- 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled'
  -- Сумма
  amount INTEGER NOT NULL, -- в копейках
  currency TEXT DEFAULT 'RUB',
  -- Статус
  status payment_status DEFAULT 'pending',
  method payment_method, -- 'card' | 'sbp' | 'cash' | 'split' | 'installment' | 'yookassa'
  -- Эскроу
  escrow_released_at TIMESTAMPTZ,
  -- Возврат
  refund_amount INTEGER,
  refund_reason TEXT,
  refunded_at TIMESTAMPTZ,
  -- Metadata
  metadata JSONB,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.payments IS 'Платежи Yookassa';
CREATE INDEX idx_payments_order ON public.payments(order_id);
CREATE INDEX idx_payments_status ON public.payments(status);
CREATE INDEX idx_payments_yookassa_id ON public.payments(yookassa_payment_id);

-- ===== 11. Deliveries =====
CREATE TABLE IF NOT EXISTS public.deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  courier_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Статус
  status TEXT DEFAULT 'assigned', -- 'assigned' | 'picked_up' | 'on_the_way' | 'delivered' | 'failed'
  -- Адрес
  address TEXT NOT NULL,
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  -- Время
  pickup_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  estimated_time TIMESTAMPTZ,
  -- Финансы
  cost INTEGER NOT NULL DEFAULT 0, -- в копейках
  courier_earnings INTEGER DEFAULT 0,
  -- Заметки
  notes TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.deliveries IS 'Доставки заказов';
CREATE INDEX idx_deliveries_order ON public.deliveries(order_id);
CREATE INDEX idx_deliveries_courier ON public.deliveries(courier_id);
CREATE INDEX idx_deliveries_status ON public.deliveries(status);

-- ===== 12. RLS политики =====

-- 12.1. product_categories — public read
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories_select_public" ON public.product_categories
  FOR SELECT USING (is_active = TRUE);
-- Админ может редактировать
CREATE POLICY "categories_write_admin" ON public.product_categories
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN') AND ur.is_active = TRUE)
  );

-- 12.2. products — public read published, write только кондитер
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_select_public" ON public.products
  FOR SELECT USING (status = 'published' OR deleted_at IS NOT NULL);
-- Кондитер может управлять своими товарами
CREATE POLICY "products_insert_own" ON public.products
  FOR INSERT WITH CHECK (
    auth.uid() = confectioner_id AND
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('CONFECTIONER', 'SUPPLIER')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "products_update_own" ON public.products
  FOR UPDATE USING (auth.uid() = confectioner_id);
CREATE POLICY "products_delete_own" ON public.products
  FOR DELETE USING (auth.uid() = confectioner_id);
-- Админ может всё
CREATE POLICY "products_admin_all" ON public.products
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
            AND ur.is_active = TRUE)
  );

-- 12.3. product_images — public read, write только владелец товара
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_images_select_public" ON public.product_images
  FOR SELECT USING (TRUE);
CREATE POLICY "product_images_insert_own" ON public.product_images
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.confectioner_id = auth.uid())
  );
CREATE POLICY "product_images_update_own" ON public.product_images
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.confectioner_id = auth.uid())
  );
CREATE POLICY "product_images_delete_own" ON public.product_images
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.confectioner_id = auth.uid())
  );

-- 12.4. product_attributes — public read, write владелец товара
ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_attributes_select_public" ON public.product_attributes
  FOR SELECT USING (TRUE);
CREATE POLICY "product_attributes_write_own" ON public.product_attributes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_id AND p.confectioner_id = auth.uid())
  );

-- 12.5. product_reviews — public read approved, write own
ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_select_public" ON public.product_reviews
  FOR SELECT USING (status = 'approved' OR user_id = auth.uid());
CREATE POLICY "reviews_insert_own" ON public.product_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reviews_update_own" ON public.product_reviews
  FOR UPDATE USING (auth.uid() = user_id AND status = 'pending');
CREATE POLICY "reviews_delete_own" ON public.product_reviews
  FOR DELETE USING (auth.uid() = user_id);
-- Админ/модератор может модерировать
CREATE POLICY "reviews_moderate_admin" ON public.product_reviews
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
            AND ur.is_active = TRUE)
  );

-- 12.6. product_favorites — только свои
ALTER TABLE public.product_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "favorites_select_own" ON public.product_favorites
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "favorites_insert_own" ON public.product_favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "favorites_delete_own" ON public.product_favorites
  FOR DELETE USING (auth.uid() = user_id);

-- 12.7. cart_items — только свои (через user_id ИЛИ session_id)
-- ВАЖНО: session_id передаётся через cookie, RLS проверяет через auth.uid()
-- Для анонимной корзины используем service_role client
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cart_select_own" ON public.cart_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cart_insert_own" ON public.cart_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cart_update_own" ON public.cart_items
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "cart_delete_own" ON public.cart_items
  FOR DELETE USING (auth.uid() = user_id);

-- 12.8. orders — пользователь видит свои, кондитер свои, админ все
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_select_own" ON public.orders
  FOR SELECT USING (
    auth.uid() = user_id OR
    auth.uid() = confectioner_id OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'COURIER', 'SUPPORT')
            AND ur.is_active = TRUE)
  );
CREATE POLICY "orders_insert_own" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "orders_update_own" ON public.orders
  FOR UPDATE USING (
    auth.uid() = user_id OR
    auth.uid() = confectioner_id OR
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'COURIER')
            AND ur.is_active = TRUE)
  );

-- 12.9. order_items — через order_id (наследуют от orders)
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_items_select_own" ON public.order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND (
              o.user_id = auth.uid() OR
              o.confectioner_id = auth.uid() OR
              EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                      AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
                      AND ur.is_active = TRUE)
            ))
  );

-- 12.10. payments — через order_id
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_select_own" ON public.payments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND (
              o.user_id = auth.uid() OR
              o.confectioner_id = auth.uid() OR
              EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                      AND ur.role IN ('ADMIN', 'SUPER_ADMIN', 'INSPECTOR')
                      AND ur.is_active = TRUE)
            ))
  );

-- 12.11. deliveries — через order_id + courier
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deliveries_select_own" ON public.deliveries
  FOR SELECT USING (
    auth.uid() = courier_id OR
    EXISTS (SELECT 1 FROM public.orders o
            WHERE o.id = order_id AND (
              o.user_id = auth.uid() OR
              o.confectioner_id = auth.uid() OR
              EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                      AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
                      AND ur.is_active = TRUE)
            ))
  );
CREATE POLICY "deliveries_update_courier" ON public.deliveries
  FOR UPDATE USING (auth.uid() = courier_id);

-- ===== 13. Triggers =====

-- updated_at для всех таблиц
CREATE OR REPLACE FUNCTION public.handle_marketplace_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_updated_at();

CREATE TRIGGER product_reviews_updated_at
  BEFORE UPDATE ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_updated_at();

CREATE TRIGGER cart_items_updated_at
  BEFORE UPDATE ON public.cart_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_updated_at();

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_updated_at();

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_updated_at();

CREATE TRIGGER deliveries_updated_at
  BEFORE UPDATE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.handle_marketplace_updated_at();

-- Auto-generate order number при INSERT
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.number IS NULL THEN
    SELECT 'ORD-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' ||
           LPAD((COALESCE(MAX(EXTRACT(YEAR FROM created_at)::TEXT || LPAD(CAST(SUBSTRING(number FROM 6) AS INTEGER), 4, '0')), '0')::INTEGER + 1)::TEXT, 4, '0')
    INTO NEW.number
    FROM public.orders
    WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_generate_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_order_number();

-- Update products.metrics при INSERT review
CREATE OR REPLACE FUNCTION public.update_product_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.products SET
    rating_average = (
      SELECT COALESCE(AVG(rating), 0) FROM public.product_reviews
      WHERE product_id = NEW.product_id AND status = 'approved'
    ),
    reviews_count = (
      SELECT COUNT(*) FROM public.product_reviews
      WHERE product_id = NEW.product_id AND status = 'approved'
    )
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_reviews_update_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_product_rating();

-- ===== 14. Permissions =====
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON
  public.products, public.product_images, public.product_attributes,
  public.product_reviews, public.product_favorites,
  public.cart_items, public.orders, public.order_items
TO authenticated;

-- ===== Готово =====
-- Тест: SELECT * FROM public.product_categories LIMIT 5;
--       SELECT * FROM public.products LIMIT 5;
--       SELECT * FROM public.orders LIMIT 5;
