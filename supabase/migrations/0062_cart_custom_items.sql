-- 0062: серверная персистентность корзины — поддержка custom-позиций конструктора
--
-- Контекст (feature cart-persistence):
--   cart_items (0002) требовала product_id NOT NULL, но custom-торты конструктора
--   товара в БД не имеют (productId = "" на клиенте). Их снимок (title/image/price/
--   confectionerId/config.custom) хранится в JSONB-колонке metadata.
--
-- Аддитивная миграция (без разрушения данных):
--   1. product_id становится nullable — custom-позиции пишутся без товара.
--   2. metadata JSONB — снимок custom-позиции или доп-атрибуты товарной.
--   3. CHECK cart_items_product_or_custom_check — позиция обязана быть либо
--      товарной (product_id), либо custom (metadata->>'custom').
--   Существующие строки (product_id NOT NULL, metadata NULL) проходят проверку.

ALTER TABLE public.cart_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE public.cart_items ADD CONSTRAINT cart_items_product_or_custom_check
  CHECK (product_id IS NOT NULL OR (metadata IS NOT NULL AND metadata ? 'custom'));
COMMENT ON COLUMN public.cart_items.metadata IS 'Снимок custom-позиции конструктора (title/image/price/confectionerId/config.custom) или доп-атрибуты товарной позиции';
