-- Bootstrap the Storage API's migration ledger before storage-api:v1.14.5 starts.
-- The Storage API runner inserts migration 0001 before executing its SQL body.
CREATE TABLE IF NOT EXISTS storage.migrations (
  id integer PRIMARY KEY,
  name varchar(100) UNIQUE NOT NULL,
  hash varchar(40) NOT NULL,
  executed_at timestamp DEFAULT current_timestamp
);
