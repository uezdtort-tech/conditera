-- ============================================================================
-- 0012_add_role_enum_values.sql
--
-- PostgreSQL allows ALTER TYPE ... ADD VALUE in a transaction, but the new
-- enum value cannot be used until that transaction commits. This migration
-- intentionally contains only enum catalog changes. The following 0012a
-- migration creates constraints and schema objects that reference these
-- values, in a separate committed migration transaction.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'RECIPE_DEVELOPER'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'RECIPE_DEVELOPER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'LOYALTY_PARTNER'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'LOYALTY_PARTNER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'AI_ASSISTANT'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'AI_ASSISTANT';
  END IF;
END $$;
