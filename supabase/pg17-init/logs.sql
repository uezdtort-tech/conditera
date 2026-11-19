\getenv pguser POSTGRES_USER
\getenv pgdb POSTGRES_DB

\connect _supabase
CREATE SCHEMA IF NOT EXISTS _analytics;
ALTER SCHEMA _analytics OWNER TO :"pguser";
\connect :pgdb
