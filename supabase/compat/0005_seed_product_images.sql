-- ============================================================================
-- 0005_seed_product_images.sql — привязка фотографий товаров витрины.
--
-- Зачем: seed_vitrine.sql вставляет товары без images → карточки каталога
-- и главной показывали заглушки. Файлы лежат локально в
-- public/uploads/products/<slug>.png (поставляются с репозиторием) —
-- никаких внешних CDN не требуется, работает офлайн.
--
-- products.images — text[] (udt _text). Идемпотентно: обновление по slug,
-- только если images пуст.
-- ============================================================================

UPDATE public.products SET images = ARRAY['/uploads/products/svadebnyy-tort-yagodnyy-barhat.png']
WHERE slug = 'svadebnyy-tort-yagodnyy-barhat' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/tort-napoleon-domashniy.png']
WHERE slug = 'tort-napoleon-domashniy' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/bento-tort-nezhnyy.png']
WHERE slug = 'bento-tort-nezhnyy' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/kapkeyki-vanilnyye-12.png']
WHERE slug = 'kapkeyki-vanilnyye-12' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/makarons-assorti-15.png']
WHERE slug = 'makarons-assorti-15' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/pryaniki-rospis-9.png']
WHERE slug = 'pryaniki-rospis-9' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/tort-korovka-3d.png']
WHERE slug = 'tort-korovka-3d' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/buquet-zeefirnyy.png']
WHERE slug = 'buquet-zeefirnyy' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/pastila-yabloko-bez-sahara.png']
WHERE slug = 'pastila-yabloko-bez-sahara' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/chokolatnyy-candy-bar.png']
WHERE slug = 'chokolatnyy-candy-bar' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/deserty-portionnyye-20.png']
WHERE slug = 'deserty-portSIONnyye-20' AND coalesce(cardinality(images), 0) = 0;

UPDATE public.products SET images = ARRAY['/uploads/products/lollipop-candy-bar-25.png']
WHERE slug = 'lollipop-candy-bar-25' AND coalesce(cardinality(images), 0) = 0;
