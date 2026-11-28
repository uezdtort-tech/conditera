-- 0062_cart_custom_items.sql — RETIRED / NO-OP.
--
-- Историческая миграция создавала metadata + cart_items_product_or_custom_check.
-- Она конфликтует с канонической моделью 0062a_cart_sync_custom.sql
-- (custom_config + client_ref) и блокирует custom-позиции без metadata.
-- Файл сохраняется для совместимости с migration ledger; новые базы не
-- создают устаревшую колонку/constraint. Для существующих баз ограничение
-- снимает 0118_retire_legacy_cart_metadata_constraint.sql.
DO $$
BEGIN
  RAISE NOTICE '0062_cart_custom_items retired; canonical cart model is custom_config + client_ref';
END $$;
