-- 0092_postgrest_maintenance_enum_compat.sql
-- PostgREST emits unquoted enum type identifiers for maintenance_logs writes.
-- PostgreSQL folds those identifiers to lowercase, while the legacy Prisma
-- migration created quoted CamelCase enum types. Move only these two columns
-- to lowercase enum types so the REST API can bind them reliably.
-- Existing enum values and stored rows are preserved.

DO $$
BEGIN
  CREATE TYPE public.maintenancetype AS ENUM (
    'BACKUP_FULL',
    'BACKUP_INCREMENTAL',
    'CLEANUP_LOGS',
    'CLEANUP_SESSIONS',
    'CLEANUP_NOTIFICATIONS',
    'CLEANUP_CARTS',
    'CLEANUP_ORPHANS',
    'VACUUM'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.maintenancestatus AS ENUM (
    'queued',
    'running',
    'success',
    'failed',
    'partial'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE public.maintenance_logs
  ALTER COLUMN "type" DROP DEFAULT,
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE public.maintenance_logs
  ALTER COLUMN "type" TYPE public.maintenancetype
    USING "type"::text::public.maintenancetype,
  ALTER COLUMN "status" TYPE public.maintenancestatus
    USING "status"::text::public.maintenancestatus;

ALTER TABLE public.maintenance_logs
  ALTER COLUMN "status" SET DEFAULT 'queued'::public.maintenancestatus;

COMMENT ON TYPE public.maintenancetype IS
  'Lowercase PostgreSQL identifier for PostgREST-compatible maintenance log types.';
COMMENT ON TYPE public.maintenancestatus IS
  'Lowercase PostgreSQL identifier for PostgREST-compatible maintenance log statuses.';

-- PostgREST starts before the application migrations in the single-container
-- runtime. Force a schema-cache refresh after changing the enum OIDs.
NOTIFY pgrst, 'reload schema';
