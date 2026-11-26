-- ============================================================================
-- 0117_restrict_public_analytics_and_trigger_rpcs.sql
--
-- RELEASE SECURITY: analytics materialized views are not public catalog data.
-- They contain payment totals, order revenue, customer counts, courier
-- performance and confectioner revenue. They have no RLS support; access must
-- be controlled by GRANTs. No application/browser code references these views.
--
-- SECURITY DEFINER trigger functions are executable by the trigger mechanism,
-- not by arbitrary PostgREST RPC callers. Remove direct EXECUTE grants while
-- leaving the triggers themselves intact.
--
-- search_products is intentionally not changed: the marketplace browser calls
-- it for public catalogue search. auto_assign_confectioner and financial RPCs
-- are already restricted by 0077_release_security_closures.sql.
--
-- Idempotent and safe on rerun. No rows or business data are modified.
-- ============================================================================

DO $$
DECLARE
  view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'analytics_delivery_performance',
    'analytics_financial_summary',
    'analytics_popular_fillings',
    'analytics_sales_by_day',
    'analytics_top_confectioners'
  ] LOOP
    IF to_regclass(format('public.%I', view_name)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', view_name);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', view_name);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', view_name);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', view_name);
      END IF;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;
    END IF;
  END IF;

  IF to_regprocedure('public.log_order_status_change()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.log_order_status_change() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.log_order_status_change() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON FUNCTION public.log_order_status_change() FROM authenticated;
    END IF;
  END IF;

  IF to_regprocedure('public.release_escrow_after_delivery()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.release_escrow_after_delivery() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.release_escrow_after_delivery() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON FUNCTION public.release_escrow_after_delivery() FROM authenticated;
    END IF;
  END IF;

  IF to_regprocedure('public.save_page_version()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.save_page_version() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.save_page_version() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON FUNCTION public.save_page_version() FROM authenticated;
    END IF;
  END IF;

  IF to_regprocedure('public.update_settings_updated_by()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.update_settings_updated_by() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.update_settings_updated_by() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON FUNCTION public.update_settings_updated_by() FROM authenticated;
    END IF;
  END IF;
END $$;

-- Contract: no direct client SELECT on analytics materialized views.
DO $$
DECLARE
  view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'analytics_delivery_performance',
    'analytics_financial_summary',
    'analytics_popular_fillings',
    'analytics_sales_by_day',
    'analytics_top_confectioners'
  ] LOOP
    IF to_regclass(format('public.%I', view_name)) IS NOT NULL THEN
      IF has_table_privilege('anon', format('public.%I', view_name), 'SELECT')
         OR has_table_privilege('authenticated', format('public.%I', view_name), 'SELECT') THEN
        RAISE EXCEPTION '0109 security regression: client SELECT remains on public.%', view_name;
      END IF;
    END IF;
  END LOOP;
END $$;
