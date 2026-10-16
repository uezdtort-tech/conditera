/**
 * Регрессионные тесты GET /api/health — когерентность тела и HTTP-статуса (DEV-17)
 * + GoTrue reachability probe (v4.1 Этап 3.1 / C-1, DEV-18 follow-up).
 *
 * Контракт готовности (TZ v4.0 §9):
 *   - БД доступна  → HTTP 200,  database:"ok",          top-level status:"ok" (при настроенных required env)
 *   - БД недоступна → HTTP 503, database:"unavailable", top-level status:"degraded"
 *     (503 с status:"ok" в теле — противоречие, запрещено)
 *   - n8n недоступен → fail-open по задокументированному контракту (докблок роута):
 *     не влияет ни на HTTP-код, ни на top-level status; только поле n8n:"unavailable".
 *
 * GoTrue probe (v4.1 Этап 3.1, GET {SUPABASE_URL}/auth/v1/health, таймаут 3s):
 *   - configured + 2xx → auth:"ok", reachability:"reachable";
 *   - configured + unreachable В PRODUCTION (сетевая ошибка или не-2xx, вкл.
 *     501-заглушку) → HTTP 200 (БД-гейт не тронут), auth:"unreachable",
 *     top-level status:"degraded" — семантика required:true;
 *   - dev/стаб (501) → классификация фактическая (auth:"unreachable"), но
 *     БЕЗ production-failure: status остаётся "ok" (false-positive исключён);
 *   - not-configured (dev) → auth:"not-configured", проба НЕ выполняется
 *     (нет fetch на /auth/v1/health), деградация только от env-presence
 *     компонента supabase (прежнее поведение).
 *   Гейт регистрации fail-closed (DEV-18) не обходится и не ослабляется.
 *
 * Моки: @/lib/postgrest/pool (SELECT 1) и global fetch (n8n + GoTrue probes) —
 * герметично, без сети.
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

// --- GoTrue reachability probe (v4.1 Этап 3.1 / C-1) ---

/**
 * Временная установка NODE_ENV с гарантированным восстановлением.
 * vitest по умолчанию ставит NODE_ENV="test" — т.е. не "production" и не
 * "development"; прод- и dev-сценарии задают значение явно.
 * (process.env.NODE_ENV в next-env типах read-only — мутируем через алиас.)
 */
async function withNodeEnv<T>(value: "production" | "development", fn: () => Promise<T>): Promise<T> {
  const env = process.env as { NODE_ENV?: string };
  const saved = env.NODE_ENV;
  env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    env.NODE_ENV = saved;
  }
}

function gotrueDep(json: { dependencies: Array<{ name: string }> }) {
  return json.dependencies.find((d) => d.name === "auth_gotrue") as
    | { name: string; required: boolean; configured: boolean; reachability: string; details?: string }
    | undefined;
}

describe("GET /api/health — GoTrue reachability probe (v4.1 Этап 3.1 / C-1)", () => {
  it("configured + GoTrue 2xx → auth:'ok', reachability:'reachable', probe бьёт в /auth/v1/health, status:'ok'", async () => {
    fetchMock.mockResolvedValue({ status: 200 } as Response);
    const res = await withNodeEnv("production", callGet);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.auth).toBe("ok");
    expect(json.status).toBe("ok");
    const dep = gotrueDep(json);
    expect(dep).toBeDefined();
    expect(dep!.required).toBe(true);
    expect(dep!.configured).toBe(true);
    expect(dep!.reachability).toBe("reachable");
    // Проба идёт именно в канонический health-эндпоинт GoTrue (тот же base-path,
    // что и admin.createUser регистрации)
    const gotrueCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/auth/v1/health"));
    expect(gotrueCall).toBeDefined();
  });

  it("production + configured + GoTrue недостижим (сетевая ошибка) → HTTP 200, auth:'unreachable', status:'degraded' (required-семантика, БД-гейт не тронут)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await withNodeEnv("production", callGet);
    // БД жива → HTTP 200: auth-деградация не гейтит readiness-код (как и env-деградация)
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.database).toBe("ok");
    expect(json.auth).toBe("unreachable");
    expect(json.status).toBe("degraded");
    const dep = gotrueDep(json);
    expect(dep!.reachability).toBe("unreachable");
    // Прод-details явно называет следствие fail-closed (DEV-18)
    expect(dep!.details).toContain("fail-closed");
  });

  it("production + configured + GoTrue 501 (сигнатура заглушки) → не считается reachable: status:'degraded'", async () => {
    fetchMock.mockResolvedValue({ status: 501 } as Response);
    const res = await withNodeEnv("production", callGet);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.auth).toBe("unreachable");
    expect(json.status).toBe("degraded");
    expect(gotrueDep(json)!.details).toContain("HTTP 501");
  });

  it("dev + локальная заглушка 501 → auth:'unreachable' (факт), но НЕТ production-failure: status:'ok', HTTP 200", async () => {
    fetchMock.mockResolvedValue({ status: 501 } as Response);
    const res = await withNodeEnv("development", callGet);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.auth).toBe("unreachable");
    // Ключевая регрессия: dev/стаб не маркируется как прод-мисконфиг
    expect(json.status).toBe("ok");
    const dep = gotrueDep(json);
    expect(dep!.reachability).toBe("unreachable");
    expect(dep!.details).toContain("dev/local runtime");
    expect(dep!.details).not.toContain("fail-closed");
  });

  it("not-configured (dev) → auth:'not-configured', проба НЕ выполняется (нет fetch на /auth/v1/health), деградация только от env-presence supabase", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await withNodeEnv("development", callGet);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.auth).toBe("not-configured");
    const dep = gotrueDep(json);
    expect(dep!.configured).toBe(false);
    expect(dep!.reachability).toBe("not-configured");
    // Проба не стреляла в сеть при отсутствии env
    const gotrueCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/auth/v1/health"));
    expect(gotrueCall).toBeUndefined();
    // Деградация — прежняя env-семантика компонента supabase (required, env-presence),
    // а не результат пробы: details пробы не говорят о прод-отказе.
    const supabaseDep = json.dependencies.find((d: { name: string }) => d.name === "supabase");
    expect(supabaseDep.configured).toBe(false);
    expect(json.status).toBe("degraded");
    expect(dep!.details).toContain("probe skipped");
  });
});
