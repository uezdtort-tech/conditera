-- 0025_grants_and_fixes.sql
-- ============================================================================
-- Догоняющая миграция: GRANT прав для таблиц из миграции 0012 и фикс схем.
--
-- Проблемы:
--   1. recipe_marketplace, recipe_purchases, recipe_subscriptions,
--      loyalty_partners, loyalty_cross_actions, loyalty_point_exchanges,
--      ai_assistant_conversations, ai_assistant_logs — не имели GRANT для
--      service_role, anon, authenticated.
--   2. product_images — нужны GRANT для batch fetch в products API.
-- ============================================================================

-- ===== 1. GRANT для recipe_marketplace и связанных таблиц =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_marketplace TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_purchases TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_subscriptions TO anon, authenticated, service_role;

-- ===== 2. GRANT для loyalty таблиц =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loyalty_partners TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loyalty_cross_actions TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loyalty_point_exchanges TO anon, authenticated, service_role;

-- ===== 3. GRANT для AI таблиц =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_assistant_conversations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_assistant_logs TO anon, authenticated, service_role;

-- ===== 4. GRANT для product_images (нужно для batch fetch в products API) =====
GRANT SELECT ON public.product_images TO anon, authenticated, service_role;

-- ===== 5. GRANT для holidays (migration 0021) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO anon, authenticated, service_role;

-- ===== 6. GRANT для confectioner_capabilities (migration 0022) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.confectioner_capabilities TO anon, authenticated, service_role;

-- ===== 7. GRANT для pricing tables (migration 0023) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.confectioner_pricing TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_requests TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.confectioner_quotes TO anon, authenticated, service_role;

-- ===== 8. GRANT для fillings (migration 0020) =====
-- fillings already had grants from 0010, but make sure service_role has access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fillings TO service_role;

-- ===== 9. GRANT для audit_log (migration 0018) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO service_role;

-- ===== 10. GRANT для all tables created by 0019 migration =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_messages TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venues TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_escalations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moderation_reports TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payouts TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fraud_alerts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_products TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.abandoned_cart_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fraud_log TO service_role;

-- ===== 11. GRANT для confectioner_pricing sequences (if any) =====
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- ===== 12. Verify: list all tables without GRANT for service_role =====
-- This is a diagnostic query, not an action.
-- Run after migration to check:
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public'
--   AND tablename NOT IN (
--     SELECT table_name FROM information_schema.role_table_grants
--     WHERE grantee = 'service_role' AND privilege_type = 'SELECT'
--   );
