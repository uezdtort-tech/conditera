-- Supabase Realtime требует отдельную схему для Ecto migrations.
-- Инициализируется только в новом изолированном PG17 rehearsal-кластере.
CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
ALTER SCHEMA _realtime OWNER TO supabase_admin;
