import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const compose = readFileSync(resolve(process.cwd(), "docker-compose.supabase.yml"), "utf8");
const kong = readFileSync(resolve(process.cwd(), "supabase/kong.yml"), "utf8");

describe("Kong 2.8 Compose contract", () => {
  it("uses the supported DB-less mode string", () => {
    expect(compose).toMatch(/^      KONG_DATABASE: ["']off["']\s*$/m);
    expect(compose).not.toMatch(/^      KONG_DATABASE: ["']?false["']?\s*$/m);
  });

  it("declares every plugin required by the declarative Kong config", () => {
    const pluginsLine = compose.match(/^      KONG_PLUGINS: (.+)$/m)?.[1] ?? "";
    const configured = new Set(pluginsLine.split(",").map((name) => name.trim()));
    const required = [...new Set([...kong.matchAll(/^\s*- name: ([a-z0-9-]+)\s*$/gm)].map((match) => match[1]).filter((name) => ["cors", "key-auth", "acl", "rate-limiting"].includes(name)))];
    for (const plugin of required) {
      expect(configured.has(plugin), `KONG_PLUGINS is missing ${plugin}`).toBe(true);
    }
  });

  it("uses exact uppercase Kong NGINX variable names and string values", () => {
    expect(compose).toMatch(/^      KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: ["']160k["']\s*$/m);
    expect(compose).toMatch(/^      KONG_NGINX_PROXY_PROXY_BUFFERS: ["']64 160k["']\s*$/m);
    expect(compose).toMatch(/^      KONG_NGINX_PROXY_PROXY_BUSY_BUFFERS_SIZE: ["']320k["']\s*$/m);
    expect(compose).not.toMatch(/^\s*KONG_NGINX_PROXY_(?:PROXY_buffers|proxy_busy_buffers_size)\s*:/m);
  });
});
