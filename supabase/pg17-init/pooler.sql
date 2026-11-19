\getenv pguser POSTGRES_USER
\getenv pgdb POSTGRES_DB

\connect _supabase
CREATE SCHEMA IF NOT EXISTS _supavisor;
ALTER SCHEMA _supavisor OWNER TO :"pguser";
\connect :pgdb
