import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const compose = await readFile(new URL("../../docker-compose.supabase.yml", import.meta.url), "utf8");
assert.match(
  compose,
  /^      KONG_DATABASE: ["']off["']\s*$/m,
  'Kong 2.8 DB-less mode must use the string KONG_DATABASE: "off".'
);
assert.match(
  compose,
  /^      KONG_DECLARATIVE_CONFIG: \/var\/lib\/kong\/kong\.yml\s*$/m,
  "Kong must load the repository declarative configuration."
);
assert.doesNotMatch(
  compose,
  /^\s*KONG_NGINX_PROXY_[A-Za-z0-9_]+\s*:/m,
  "Kong proxy buffer overrides must remain unset until verified against the running Kong 2.8 image."
);

console.log("Kong Compose contract: PASS (DB-less mode, declarative config, no unverified buffer overrides).");
