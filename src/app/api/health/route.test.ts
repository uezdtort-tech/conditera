/**
 * Регрессионные тесты GET /api/health — когерентность тела и HTTP-статуса (DEV-17).
 *
 * Контракт готовности (TZ v4.0 §9):
 *   - БД доступна  → HTTP 200,  database:"ok",          top-level status:"ok" (при настроенных required env)
 *   - БД недоступна → HTTP 503, database:"unavailable", top-level status:"degraded"
 *     (503 с status:"ok" в теле — противоречие, запрещено)
 *   - n8n недоступен → fail-open по задокументированному контракту (докблок роута):
 *     не влияет ни на HTTP-код, ни на top-level status; только поле n8n:"unavailable".
 *
 * Моки: @/lib/postgrest/pool (SELECT 1) и global fetch (n8n probe) — герметично, без сети.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

// --- Моки модулей (герметично, без сети и БД) ---

const queryMock = vi.fn();

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

const fetchMock = vi.fn();

// Required env-переменные (влияют на allRequiredOk). Значения — синтетические
// заглушки присутствия, не секреты.
const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "CRON_SECRET",
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of REQUIRED_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    process.env[key] = `test-presence-${key.toLowerCase()}`;
  }
  queryMock.mockResolvedValue([[{ "?column?": 1 }]]); // SELECT 1 → ок
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ status: 200 } as Response); // n8n жив
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of REQUIRED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function callGet() {
  return GET();
}

describe("GET /api/health — когерентность статуса и тела (DEV-17)", () => {
  it("БД доступна + env настроен → 200, database:'ok', status:'ok'", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.app).toBe("ok");
    expect(json.database).toBe("ok");
    expect(json.status).toBe("ok");
  });

  it("БД недоступна (SELECT 1 упал) → 503 + database:'unavailable' + status:'degraded' (без противоречий)", async () => {
    queryMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await callGet();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.database).toBe("unavailable");
    expect(json.status).toBe("degraded"); // регрессия: раньше был "ok" при 503
    // Свойство когерентности: 503 ⟺ database:"unavailable"
    expect((res.status === 503) === (json.database === "unavailable")).toBe(true);
    expect((json.status === "ok") === (res.status === 200)).toBe(true);
  });

  it("n8n недоступен → fail-open по контракту: HTTP 200, n8n:'unavailable', status:'ok'", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await callGet();
    expect(res.status).toBe(200); // n8n НЕ гейтит readiness (докблок роута)
    const json = await res.json();
    expect(json.n8n).toBe("unavailable");
    expect(json.database).toBe("ok");
    expect(json.status).toBe("ok");
  });

  it("required env отсутствует (БД жива) → 200 + status:'degraded' (env-деградация не гейтит readiness)", async () => {
    delete process.env.CRON_SECRET;
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.database).toBe("ok");
    expect(json.status).toBe("degraded");
    const cron = json.dependencies.find((d: { name: string }) => d.name === "cron_secret");
    expect(cron.configured).toBe(false);
  });

  it("комбинированная деградация: БД вниз + env не настроен → 503 + status:'degraded'", async () => {
    queryMock.mockRejectedValue(new Error("ECONNREFUSED"));
    delete process.env.JWT_SECRET;
    const res = await callGet();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.database).toBe("unavailable");
    expect(json.status).toBe("degraded");
  });

  it("тело содержит обязательные поля контракта и форму v2.0 (сохранённые проверки прежнего suite)", async () => {
    const res = await callGet();
    const json = await res.json();
    // Контракт готовности
    expect(json).toHaveProperty("app");
    expect(json).toHaveProperty("database");
    expect(json).toHaveProperty("n8n");
    expect(json).toHaveProperty("status");
    // Форма ответа (регрессия формы, ранее из первого suite route.test.ts)
    expect(json.service).toBe("conditera");
    expect(typeof json.version).toBe("string");
    expect(json.version.length).toBeGreaterThan(0);
    expect(new Date(json.timestamp).getTime()).not.toBeNaN();
    expect(typeof json.uptime).toBe("number");
    expect(json.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof json.environment).toBe("string");
    expect(json.features).toBeDefined();
    expect(json.features.roles_v2).toBe(true);
    expect(json.features.rbac).toBe(true);
    expect(json.features.csrf_protection).toBe(true);
    expect(Array.isArray(json.dependencies)).toBe(true);
    const supabaseDep = json.dependencies.find((d: { name: string }) => d.name === "supabase");
    expect(supabaseDep).toBeDefined();
    expect(typeof supabaseDep.required).toBe("boolean");
    expect(typeof supabaseDep.configured).toBe("boolean");
  });
});
