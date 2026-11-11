-- 0080_cart_remove_zombie_check.sql — Z-v24: устранение конфликта дубликата 0062.
--
-- Контекст (docs/release/Z-V24_CART_MIGRATION_CONFLICT_RESOLUTION.md):
--   supabase/migrations/0062_cart_custom_items.sql — воскрешённый дубликат номера 0062
--   (удалён аудитом eabf28a, повторно внесён массовым коммитом 9e6a516). Он добавлял
--   CHECK cart_items_product_or_custom_check (custom-строка обязана иметь
--   metadata ? 'custom') и колонку metadata, тогда как канонический контракт
--   (0062_cart_sync_custom.sql + POST /api/cart + cart-merge.ts) пишет custom_config
--   и никогда не пишет metadata. Итог: вставка custom-позиции нарушала CHECK
--   (SQLSTATE 23514) → HTTP 500 на POST /api/cart.
--
-- Миграция чинит базы, где зомби успел примениться, и является полным no-op
-- на чистых установках без зомби-объектов. Повторный запуск безопасен.
--
-- ПОРЯДОК КРИТИЧЕН: зомби-CHECK снимается ДО переноса данных — иначе сам UPDATE
-- (metadata: значение → NULL) нарушает ещё живой CHECK для спасаемой строки
-- (product_id IS NULL, metadata → NULL ⇒ CHECK = false). Проверено на PG 18.4.

-- 1. Снятие зомби-ограничения (идемпотентно; на чистых установках объекта нет).
ALTER TABLE public.cart_items
  DROP CONSTRAINT IF EXISTS cart_items_product_or_custom_check;

-- 2. Спасение данных зомби-эры + условная очистка артефакта — ТОЛЬКО если
--    колонка metadata существует (в pre-zombie базах её нет; статический SQL
--    внутри невыполняемой ветки plpgsql не планируется).
--    Спасение: строка custom без custom_config (состояние, невозможное при живом
--    cart_items_kind_check, но возможное в экзотических БД после ручных правок
--    леджера/снятия kind_check) получает ПОЛНУЮ копию metadata в custom_config —
--    без потерь; после этого строка удовлетворяет каноническому kind_check.
--    Колонка metadata удаляется ТОЛЬКО если в ней нет данных; иначе сохраняется
--    вместе с данными (RAISE NOTICE). Приложение её не читает и не пишет.
DO $zv24$
DECLARE zv24_nonnull int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cart_items'
      AND column_name = 'metadata'
  ) THEN
    UPDATE public.cart_items
    SET custom_config = metadata,
        metadata = NULL
    WHERE product_id IS NULL
      AND custom_config IS NULL
      AND metadata IS NOT NULL
      AND metadata ? 'custom';

    SELECT count(*) INTO zv24_nonnull FROM public.cart_items WHERE metadata IS NOT NULL;
    IF zv24_nonnull = 0 THEN
      ALTER TABLE public.cart_items DROP COLUMN metadata;
      RAISE NOTICE '0080: пустая колонка cart_items.metadata удалена (артефакт 0062_cart_custom_items)';
    ELSE
      RAISE NOTICE '0080: cart_items.metadata содержит % непустых строк — колонка сохранена, данные не тронуты', zv24_nonnull;
    END IF;
  END IF;
END
$zv24$;
