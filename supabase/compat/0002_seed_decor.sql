-- ============================================================================
-- 0002_seed_decor.sql — сид витрины декора для local-runtime.
--
-- Источники схемы:
--   builder_decor_shops — 0014_builder_config.sql (id TEXT PK)
--   decor_products      — 0040_local_runtime.sql (shop_id uuid, images jsonb,
--                         price numeric В РУБЛЯХ, in_stock / is_active)
--
-- Идемпотентно: ON CONFLICT (id) DO NOTHING. Фиксированные UUID-идентификаторы
-- (dddddddd-…) — чтобы decor_products.shop_id ссылался на те же строки.
-- Добавлен в SEED_FILES (scripts/db/setup.mjs) после seed_vitrine.sql.
-- ============================================================================

-- ===== Магазины декора (builder_decor_shops, 0014) =====
INSERT INTO public.builder_decor_shops
  (id, name, description, logo, website, city, delivery_cities, avg_price_level,
   rating, reviews_count, is_active, is_verified, categories, metadata)
VALUES
  ('dddddddd-0000-4000-8000-000000000001',
   'Сахарная печать',
   'Топперы, сахарная печать, вафельная бумага и фигурки для украшения тортов. Собственное производство в Москве.',
   'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=200&q=80',
   NULL,
   'Москва',
   ARRAY['Москва','Санкт-Петербург','Казань','Екатеринбург'],
   'medium',
   4.8,
   132,
   true,
   true,
   ARRAY['toppers','figures','tools'],
   '{"source":"local-runtime-seed"}'::jsonb),
  ('dddddddd-0000-4000-8000-000000000002',
   'ПекарьПро — упаковка и декор',
   'Коробки, подложки, ленты, свечи и бенгальские огни. Оптом и в розницу, доставка по всей России.',
   'https://images.unsplash.com/photo-1607344645866-009c320c5ab8?w=200&q=80',
   NULL,
   'Санкт-Петербург',
   ARRAY['Москва','Санкт-Петербург','Россия'],
   'budget',
   4.6,
   98,
   true,
   true,
   ARRAY['boxes','boards','candles','ribbon','sparklers','packaging'],
   '{"source":"local-runtime-seed"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ===== Товары декора (decor_products, 0040) =====
INSERT INTO public.decor_products
  (id, shop_id, title, description, price, images, category, in_stock, is_active)
VALUES
  ('dddddddd-1000-4000-8000-000000000001',
   'dddddddd-0000-4000-8000-000000000001',
   'Топпер «С Днём Рождения» золотой',
   'Акриловый топпер с золотым напылением, 15 см. Пищевой пластик, многоразовый.',
   350,
   '["https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=600&q=80","https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=600&q=80"]'::jsonb,
   'toppers',
   true,
   true),
  ('dddddddd-1000-4000-8000-000000000002',
   'dddddddd-0000-4000-8000-000000000001',
   'Сахарная печать «Розы» лист А4',
   'Пищевая печать на сахарной бумаге, лист А4. Безопасные красители, срок годности 6 мес.',
   490,
   '["https://images.unsplash.com/photo-1513885535751-8b9238bd345c?w=600&q=80"]'::jsonb,
   'figures',
   true,
   true),
  ('dddddddd-1000-4000-8000-000000000003',
   'dddddddd-0000-4000-8000-000000000001',
   'Набор кондитерских мешков 5 шт',
   'Многоразовые силиконовые кондитерские мешки с 4 насадками. Подходят для крема и мастики.',
   620,
   '["https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&q=80"]'::jsonb,
   'tools',
   true,
   true),
  ('dddddddd-1000-4000-8000-000000000004',
   'dddddddd-0000-4000-8000-000000000002',
   'Коробка для торта 30×30×15 см (5 шт)',
   'Прочный крафт-картон с окном. В комплекте лента и наклейки. Набор из 5 коробок.',
   890,
   '["https://images.unsplash.com/photo-1607344645866-009c320c5ab8?w=600&q=80"]'::jsonb,
   'boxes',
   true,
   true),
  ('dddddddd-1000-4000-8000-000000000005',
   'dddddddd-0000-4000-8000-000000000002',
   'Свечи-фонтанчики золотые (4 шт)',
   'Бенгальные свечи-фонтаны для торта, время горения 45 секунд. В наборе 4 шт + подставки.',
   260,
   '["https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=600&q=80"]'::jsonb,
   'candles',
   true,
   true),
  ('dddddddd-1000-4000-8000-000000000006',
   'dddddddd-0000-4000-8000-000000000002',
   'Подложка золотая усиленная 28 см (10 шт)',
   'Усиленные золотые подложки для тортов и десертов, плотный картон 2 мм. Набор 10 шт.',
   540,
   '["https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=600&q=80"]'::jsonb,
   'boards',
   false,
   true)
ON CONFLICT (id) DO NOTHING;
