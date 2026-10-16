-- ============================================================================
-- seed_slices.template.sql — ШАБЛОН наполнения фото разреза (U-06, v4.2)
-- ============================================================================
-- ВНИМАНИЕ: файл НЕ применяется автоматически (не включён в scripts/db/setup.mjs
-- и supabase/init-scripts/init-db.sh). Это заготовка для ВЛАДЕЛЬЦА: заполнить
-- плейсхолдеры __SLICE_PHOTO_*__ реальными путями к загруженным фотографиям,
-- затем применить вручную (psql / node-скрипт) ИЛИ завести контент через
-- дашборд кондитера (вкладка «Срезы», ConfectionerSliceEditorTab) или
-- POST /api/products/<id>/slices (роль CONFECTIONER + ownership).
--
-- КАК ПОЛУЧИТЬ ПУТИ К ФОТО:
--   1. Загрузить файл через POST /api/upload (multipart, ≤10 МиБ, PNG/JPG)
--      → в ответе {"url": "/uploads/misc/<uuid>.<ext>"};
--   2. Вставить этот url вместо __SLICE_PHOTO_<n>__ ниже.
--
-- МОДЕЛЬ ДАННЫХ (куда встают записи):
--   products.fillings (jsonb, миграция 0043) — массив {name, priceModifier};
--     гейт секции в карточке: product.fillings.length > 0 (product-page.tsx).
--   product_slices (миграция 0017) — фото разреза:
--     productId → products.id, fillingName === products.fillings[].name
--     (строгий матч в UI), image = URL фото, caption, sortOrder.
--   Одна строка product_slices = одно фото разреза для одной начинки.
--
-- ЧЕК-ЛИСТ КОНТЕНТА ОТ ВЛАДЕЛЬЦА (минимальный витринный набор):
--   ◻ Для 3 флагманов (…0001, …0002, …000b) — список начинок
--     products.fillings (2–3 позиции: name = каталог fillings, priceModifier).
--   ◻ По 1 реальному фото разреза на КАЖДУЮ начинку этих продуктов
--     (вертикальный/квадратный кадр, PNG/JPG, ≤10 МиБ).
--   ◻ Подпись (caption) для каждого фото — фактический состав слоёв.
--   ◻ После применения: UI-проверка карточки — секция «Срезы торта
--     по начинкам» с фото; фолбэк при отсутствии — основной продукт
--     без пустого блока (покрыто тестами product-page.slice-photos.test.tsx).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Продукт …0001 — Свадебный торт «Ягодный бархат»
-- текущее главное фото: /uploads/products/svadebnyy-tort-yagodnyy-barhat.png
-- ---------------------------------------------------------------------------
-- Шаг 1 (владелец): перечислить начинки продукта в jsonb-поле products.fillings.
-- Пример (заменить/дополнить фактическим ассортиментом):
UPDATE public.products
SET "fillings" = '[{"name": "__FILLING_1__", "priceModifier": 0},
                   {"name": "__FILLING_2__", "priceModifier": 300}]'::jsonb
WHERE "id" = 'aaaaaaaa-0000-4000-8000-000000000001';

-- Шаг 2 (владелец): фото разреза для каждой начинки (fillingName = name из шага 1).
INSERT INTO public.product_slices ("id", "productId", "fillingName", "image", "config", "caption", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('slice-0001-f1', 'aaaaaaaa-0000-4000-8000-000000000001', '__FILLING_1__',
   '__SLICE_PHOTO_1__', NULL, '__CAPTION_1__', 0, now(), now()),
  ('slice-0001-f2', 'aaaaaaaa-0000-4000-8000-000000000001', '__FILLING_2__',
   '__SLICE_PHOTO_2__', NULL, '__CAPTION_2__', 1, now(), now())
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Продукт …0002 — Домашний «Наполеон»
-- текущее главное фото: /uploads/products/tort-napoleon-domashniy.png
-- ---------------------------------------------------------------------------
UPDATE public.products
SET "fillings" = '[{"name": "__FILLING_3__", "priceModifier": 0}]'::jsonb
WHERE "id" = 'aaaaaaaa-0000-4000-8000-000000000002';

INSERT INTO public.product_slices ("id", "productId", "fillingName", "image", "config", "caption", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('slice-0002-f1', 'aaaaaaaa-0000-4000-8000-000000000002', '__FILLING_3__',
   '__SLICE_PHOTO_3__', NULL, '__CAPTION_3__', 0, now(), now())
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Продукт …000b — Порционные десерты (20 шт.)
-- текущее главное фото: /uploads/products/deserty-portionnyye-20.png
-- ---------------------------------------------------------------------------
UPDATE public.products
SET "fillings" = '[{"name": "__FILLING_4__", "priceModifier": 0}]'::jsonb
WHERE "id" = 'aaaaaaaa-0000-4000-8000-00000000000b';

INSERT INTO public.product_slices ("id", "productId", "fillingName", "image", "config", "caption", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('slice-000b-f1', 'aaaaaaaa-0000-4000-8000-00000000000b', '__FILLING_4__',
   '__SLICE_PHOTO_4__', NULL, '__CAPTION_4__', 0, now(), now())
ON CONFLICT ("id") DO NOTHING;

-- ===========================================================================
-- Проверка после применения (ожидается: n_fillings > 0 у трёх продуктов,
-- n_slices = числу загруженных фото):
--   SELECT p.id, p.title, jsonb_array_length(COALESCE(p.fillings,'[]'::jsonb)) AS n_fillings,
--          (SELECT count(*) FROM product_slices s WHERE s."productId" = p.id) AS n_slices
--   FROM products p WHERE p.id IN ('aaaaaaaa-0000-4000-8000-000000000001',
--          'aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-00000000000b');
-- ===========================================================================
