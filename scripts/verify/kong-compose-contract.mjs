import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const compose = await readFile(new URL("../../docker-compose.supabase.yml", import.meta.url), "utf8");
const serviceMatch = compose.match(/^  supabase-kong:\n([\s\S]*?)(?=^  [A-Za-z0-9_-]+:\n|^volumes:|^networks:|\s*$)/m);
assert.ok(serviceMatch, "supabase-kong service must exist in docker-compose.supabase.yml");

const service = serviceMatch[1];
assert.match(
  service,
  /^      KONG_DATABASE: ["']off["']\s*$/m,
  'Kong 2.8 DB-less mode must use the string KONG_DATABASE: "off".'
);
assert.match(
  service,
  /^      KONG_DECLARATIVE_CONFIG: \/var\/lib\/kong\/kong\.yml\s*$/m,
  "Kong must load the repository declarative configuration."
);

const forbidden = service.match(/^\s*KONG_NGINX_PROXY_[A-Z_a-z0-9]+\s*:/gm) || [];
assert.deepEqual(
  forbidden,
  [],
  "Kong proxy buffer overrides must remain unset until verified against the running Kong 2.8 image."
);

console.log("Kong Compose contract: PASS (DB-less mode, declarative config, no unverified buffer overrides).");
