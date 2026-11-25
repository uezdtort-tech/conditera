import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const compose = await readFile(new URL("../../docker-compose.supabase.yml", import.meta.url), "utf8");
const kongTemplate = await readFile(new URL("../../supabase/kong.yml", import.meta.url), "utf8");
const entrypoint = await readFile(new URL("../supabase/kong-entrypoint.sh", import.meta.url), "utf8");

for (const value of [
  'KONG_DATABASE: "off"',
  'KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: "160k"',
  'KONG_NGINX_PROXY_PROXY_BUFFERS: "64 160k"',
  'KONG_NGINX_PROXY_PROXY_BUSY_BUFFERS_SIZE: "320k"',
  'ANON_KEY: ${ANON_KEY:?ANON_KEY is required}',
  'SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY is required}',
  './scripts/supabase/kong-entrypoint.sh:/usr/local/bin/conditera-kong-entrypoint.sh:ro',
  'entrypoint: ["/bin/sh", "/usr/local/bin/conditera-kong-entrypoint.sh"]',
]) {
  assert.ok(compose.includes(value), `missing Compose contract: ${value}`);
}
assert.ok(!compose.includes("KONG_NGINX_PROXY_PROXY_buffers"));
assert.ok(!compose.includes("KONG_NGINX_PROXY_proxy_busy_buffers_size"));
assert.ok(kongTemplate.includes("${ANON_KEY}"));
assert.ok(kongTemplate.includes("${SERVICE_ROLE_KEY}"));
assert.ok(!kongTemplate.includes("${SUPABASE_ANON_KEY}"));
assert.ok(!kongTemplate.includes("${SUPABASE_SERVICE_KEY}"));
assert.ok(entrypoint.includes("chown kong:kong"));
assert.ok(entrypoint.includes("unresolved API-key placeholders remain"));
assert.ok(entrypoint.includes("placeholder/test API keys are forbidden"));

console.log("Kong Compose contract: PASS");
