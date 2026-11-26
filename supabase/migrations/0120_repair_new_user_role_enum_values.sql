-- 0120_repair_new_user_role_enum_values.sql
-- Forward compatibility for databases that applied the legacy 0012a table/policy
-- migration before the enum additions were split out of its transaction.
-- Idempotent: fresh databases already have these labels from 0012.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role' AND typnamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'public.user_role enum is missing; cannot repair role labels';
  END IF;

  ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'RECIPE_DEVELOPER';
  ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'LOYALTY_PARTNER';
  ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'AI_ASSISTANT';
END
$$;
