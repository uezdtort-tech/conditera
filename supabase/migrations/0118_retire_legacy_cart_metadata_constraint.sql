-- 0118_retire_legacy_cart_metadata_constraint.sql
--
-- The canonical cart model stores custom cake snapshots in custom_config and
-- client_ref (0062a_cart_sync_custom.sql). An older migration left a CHECK
-- constraint requiring metadata->>'custom', which rejects valid custom_config
-- rows. Remove only that obsolete constraint; retain the metadata column and
-- any historical values to avoid data loss.
DO $$
BEGIN
  IF to_regclass('public.cart_items') IS NOT NULL THEN
    ALTER TABLE public.cart_items
      DROP CONSTRAINT IF EXISTS cart_items_product_or_custom_check;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cart_items'
        AND column_name = 'metadata'
    ) THEN
      COMMENT ON COLUMN public.cart_items.metadata IS
        'Legacy snapshot column retained for compatibility; new custom cart items use custom_config + client_ref';
    END IF;
  END IF;
END $$;
