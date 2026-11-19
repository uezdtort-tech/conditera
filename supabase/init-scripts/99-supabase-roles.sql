-- Keep Supabase service-role passwords aligned with POSTGRES_PASSWORD.
-- This follows the official Supabase self-hosted docker/volumes/db/roles.sql.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';

-- This role is created by the optional pg_net / Supabase Webhooks init.
SELECT format('ALTER USER supabase_functions_admin WITH PASSWORD %L', :'pgpass')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_functions_admin')
\gexec
