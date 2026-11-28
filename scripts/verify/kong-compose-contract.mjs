import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const compose = await readFile(new URL("../../docker-compose.supabase.yml", import.meta.url), "utf8");
const kongTemplate = await readFile(new URL("../../supabase/kong.yml", import.meta.url), "utf8");
const entrypoint = await readFile(new URL("../supabase/kong-entrypoint.sh", import.meta.url), "utf8");

assert.match(compose, /^      KONG_DATABASE: ["']off["']\s*$/m);
assert.match(compose, /^      KONG_PLUGINS: .*\brate-limiting\b.*$/m);
assert.doesNotMatch(compose, /^\s*KONG_NGINX_PROXY_[A-Z_a-z]+\s*:/m,
  "Do not override Kong proxy buffers until the exact runtime requirements are verified.");
assert.match(compose, /^      SUPABASE_ANON_KEY: \$\{ANON_KEY:\?ANON_KEY is required\}\s*$/m);
assert.match(compose, /^      SUPABASE_SERVICE_KEY: \$\{SERVICE_ROLE_KEY:\?SERVICE_ROLE_KEY is required\}\s*$/m);
assert.match(compose, /^      - \.\/scripts\/supabase\/kong-entrypoint\.sh:\/usr\/local\/bin\/conditera-kong-entrypoint\.sh:ro\s*$/m);
assert.match(compose, /^    entrypoint: \["\/bin\/sh", "\/usr\/local\/bin\/conditera-kong-entrypoint\.sh"\]\s*$/m);
assert.match(kongTemplate, /\$\{SUPABASE_ANON_KEY\}/);
assert.match(kongTemplate, /\$\{SUPABASE_SERVICE_KEY\}/);
assert.doesNotMatch(kongTemplate, /\$\{(?:ANON_KEY|SERVICE_ROLE_KEY)\}/);
assert.match(entrypoint, /unresolved API-key placeholders remain/);
assert.match(entrypoint, /placeholder\/test API keys are forbidden/);
console.log("Kong Compose contract: PASS");
