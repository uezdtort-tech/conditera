/**
 * Регрессионные тесты GET /api/admin/dashboard — dev-stub удалён (P2).
 *
 * Первопричина маскировки: в dev аноним и не-администратор получали
 * фиктивные KPI (STUB_DATA: 1248 юзеров, выручка 1.84M), которые UI
 * рендерил с бейджем LIVE как настоящие.
 *
 * Новый контракт (в ЛЮБОМ окружении):
 *   a) аноним → 401, фиктивных данных нет;
 *   b) не-администратор (CUSTOMER) → 403, фиктивных данных нет;
 *   c) admin → 200 с реальными данными (stub: false);
 *   d) недоступность БД → 503 (не STUB_DATA).
 *
 * supabaseAdmin мокается цепочечным билдером (паттерн role-guards.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const USER_ADMIN = { id: "11111111-1111-4111-8111-111111111107" };
const USER_CUSTOMER = { id: "11111111-1111-4111-8111-111111111106" };

type Handler = (table: string) => unknown;

const { dbState } = vi.hoisted(() => ({
  dbState: {
    handler: null as Handler | null,
    rpcResult: { data: 1234 as unknown, error: null as unknown },
    shouldThrow: false as boolean,
  },
}));

function chainResult(result: unknown) {
  return Promise.resolve(result);
}

/** Цепочечный PostgREST-билдер: from(table) → ... → await. */
function makeBuilder(table: string) {
  const b: Record<string, unknown> = {};
  const terminal = () =>
    // user_roles (role-guard) не падает: «БД недоступна» должна ловиться
    // внутренним try — как в реальном сценарии.
    table === "user_roles"
      ? chainResult(
          dbState.handler
            ? dbState.handler(table)
            : { data: [], error: null, count: 0 }
        )
      : dbState.shouldThrow
        ? Promise.reject(new Error("DB down (simulated)"))
        : chainResult(
            dbState.handler
              ? dbState.handler(table)
              : { data: [], error: null, count: 0 }
          );
  const add = (name: string) => {
    b[name] = vi.fn((..._args: unknown[]) => b);
  };
  for (const m of [
    "select", "eq", "neq", "gte", "lte", "in", "is", "order", "limit",
    "single", "maybeSingle", "range", "update", "insert", "delete",
  ]) add(m);
  // await builder → результат
  b.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
    terminal().then(onF, onR);
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: vi.fn(() =>
      dbState.shouldThrow
        ? Promise.reject(new Error("DB down (simulated)"))
        : chainResult(dbState.rpcResult)
    ),
  },
}));

const getUserFromRequestMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequestMock(...args),
}));

import { GET } from "./route";

const BASE = "http://localhost:3000";

function req(): NextRequest {
  return new NextRequest(`${BASE}/api/admin/dashboard`, { method: "GET" });
}

beforeEach(() => {
  getUserFromRequestMock.mockReset();
  dbState.handler = (table) => {
    // requireAnyRole → user_roles через замоканный supabaseAdmin
    if (table === "user_roles") return { data: [{ role: "ADMIN" }], error: null, count: 1 };
    return { data: [], error: null, count: 0 };
  };
  dbState.shouldThrow = false;
  dbState.rpcResult = { data: 1234, error: null };
  // env-гейт getUserRoles: без этих переменных роли [] → 403
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://pgrst.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("GET /api/admin/dashboard — dev-stub удалён", () => {
  it("аноним → 401, фиктивных KPI нет (в т.ч. в dev)", async () => {
    getUserFromRequestMock.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.stub).toBeUndefined();
    expect(body.stats).toBeUndefined();
  });

  it("CUSTOMER → 403, фиктивных KPI нет (в т.ч. в dev)", async () => {
    getUserFromRequestMock.mockResolvedValue(USER_CUSTOMER);
    // Пользователь без админ-роли
    dbState.handler = (table) =>
      table === "user_roles"
        ? { data: [{ role: "CUSTOMER" }], error: null, count: 1 }
        : { data: [], error: null, count: 0 };
    const res = await GET(req());
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain("1248");
    expect(text).not.toContain("1840000");
  });

  it("admin → 200: реальные данные, stub: false", async () => {
    getUserFromRequestMock.mockResolvedValue(USER_ADMIN);
    dbState.handler = (table) => {
      if (table === "user_roles") return { data: [{ role: "ADMIN" }], error: null, count: 1 };
      if (table === "orders" || table === "profiles") return { data: [], error: null, count: 7 };
      if (table === "support_tickets" || table === "payouts" || table === "fraud_alerts") {
        return { data: [], error: null, count: 0 };
      }
      return { data: [], error: null, count: 0 };
    };
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stats: Record<string, number>;
      stub: boolean;
      platformGrowth: unknown[];
    };
    expect(body.stub).toBe(false);
    expect(body.stats.totalUsers).toBe(7);
    expect(body.stats.totalOrders).toBe(7);
    expect(Array.isArray(body.platformGrowth)).toBe(true);
  });

  it("недоступность БД → 503, а не демо-данные", async () => {
    getUserFromRequestMock.mockResolvedValue(USER_ADMIN);
    dbState.shouldThrow = true;
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.stub).toBeUndefined();
    expect(body.error).toBeTruthy();
  });
});
