/**
 * Тесты D1 (PR-6A2): POST /api/products создаёт initial-строку
 * product_price_history сразу после успешной вставки (обе ветки).
 *
 * Контракт:
 *   • CONFECTIONER-ветка: set_product_price(actor=confectioners.userId,
 *     product, variant=NULL, amount=products.price, effective_from=now(),
 *     reason='initial', source='system', actor_is_admin=false);
 *   • ADMIN-ветка: actor=body.confectionerId (владелец), actor_is_admin=true;
 *   • best-effort: сбой set_product_price НЕ ломает 201 (warn в лог);
 *   • вызов ТОЛЬКО после успешной вставки (при 500/422 истории нет).
 *
 * supabaseAdmin — per-table builder-mock; getPool — SQL-роутинг со spy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "b0000000-0000-4000-8000-000000000001";
const CONF_USER_ID = "b0000000-0000-4000-8000-000000000002"; // confectioners.userId
const ADMIN_TARGET_ID = "b0000000-0000-4000-8000-000000000003"; // admin-ветка: confectionerId
const PRODUCT_ID = "a0000000-0000-4000-8000-000000000001";

const { state, poolQueryMock, userMock, adminMock, requireRoleMock, gateMock, moderateMock } =
  vi.hoisted(() => ({
    state: {
      setPriceCalls: [] as Array<{ sql: string; params: unknown[] }>,
      setPriceErr: null as Error | null,
      insertedProducts: [] as Array<Record<string, unknown>>,
    },
    poolQueryMock: vi.fn(),
    userMock: vi.fn(),
    adminMock: vi.fn(),
    requireRoleMock: vi.fn(),
    gateMock: vi.fn(),
    moderateMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const api: Record<string, unknown> = {};
      const chain = () => api;
      Object.assign(api, {
        insert: (payload: Record<string, unknown>) => {
          if (table === "products") {
            state.insertedProducts.push(payload);
          }
          return chain();
        },
        select: chain,
        eq: chain,
        order: chain,
        limit: chain,
        range: chain,
        single: () =>
          Promise.resolve({
            data:
              table === "products"
                ? { id: PRODUCT_ID, price: state.insertedProducts.at(-1)?.price, ...(state.insertedProducts.at(-1) ?? {}) }
                : null,
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === "confectioners"
                ? { id: "d0000000-0000-4000-8000-000000000001", userId: CONF_USER_ID, businessName: "Тест-Кондитер" }
                : null,
            error: null,
          }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(res, rej),
        catch: (onRejected: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).catch(onRejected),
      });
      return api;
    }),
  },
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => userMock(...args),
}));
vi.mock("@/lib/role-guards", () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
  isAdmin: (...args: unknown[]) => adminMock(...args),
}));
vi.mock("@/lib/confectioner-gate", () => ({
  checkConfectionerGate: (...args: unknown[]) => gateMock(...args),
}));
vi.mock("@/lib/content-moderation", () => ({
  moderateContent: (...args: unknown[]) => moderateMock(...args),
}));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: poolQueryMock,
  }),
}));

import { POST } from "./route";

async function callPost(body: unknown, userId = USER_ID): Promise<Response> {
  const request = new NextRequest("http://localhost:3000/api/products", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  // getUserFromRequest читает request — подменяем после создания
  userMock.mockImplementation(async () => ({ id: userId, email: "conf@demo.ru" }));
  return POST(request);
}

function poolRouter(sql: string, params?: unknown[]): { rows: unknown[] } {
  const q = sql.trim();
  if (/set_product_price/.test(q)) {
    state.setPriceCalls.push({ sql: q, params: params ?? [] });
    if (state.setPriceErr) throw state.setPriceErr;
    return { rows: [{ result: { versionId: PRODUCT_ID, noChange: true } }] };
  }
  if (/FROM auth\.users/.test(q)) return { rows: [{ "?column?": 1 }] }; // admin: цель существует
  if (/FROM public\.profiles/.test(q)) return { rows: [{ name: "Целевой Кондитер" }] };
  return { rows: [] };
}

beforeEach(() => {
  poolQueryMock.mockReset();
  poolQueryMock.mockImplementation((sql: string, params?: unknown[]) => poolRouter(sql, params));
  userMock.mockReset();
  adminMock.mockReset();
  adminMock.mockResolvedValue(false);
  requireRoleMock.mockReset();
  requireRoleMock.mockResolvedValue(null);
  gateMock.mockReset();
  gateMock.mockResolvedValue({ allowed: true });
  moderateMock.mockReset();
  moderateMock.mockResolvedValue({ status: "ok", violations: [], reasons: [], queueId: null });
  state.setPriceCalls = [];
  state.setPriceErr = null;
  state.insertedProducts = [];
});

describe("POST /api/products — D1 initial-строка истории цен", () => {
  it("кондитер: после вставки — set_product_price(initial, system, actor=владелец, admin=false)", async () => {
    const res = await callPost({ title: "Торт D1", price: 1000, description: "Проверка initial-строки истории" });
    expect(res.status).toBe(201);

    expect(state.insertedProducts).toHaveLength(1);
    expect(state.setPriceCalls).toHaveLength(1);
    const { params } = state.setPriceCalls[0];
    expect(params[0]).toBe(CONF_USER_ID); // p_actor: владелец (confectioners.userId)
    expect(params[1]).toBe(PRODUCT_ID); // p_product_id
    expect(params[2]).toBeNull(); // p_variant_id
    expect(params[3]).toBe(1000); // p_amount = products.price
    expect(params[5]).toBe("initial"); // p_reason
    expect(params[7]).toBe("system"); // p_source
    expect(params[9]).toBeNull(); // p_idempotency_key
    expect(params[10]).toBe(false); // p_actor_is_admin
    // effective_from = now() (ISO, парсится, недалеко от текущего момента)
    const fromMs = new Date(String(params[4])).getTime();
    expect(Math.abs(Date.now() - fromMs)).toBeLessThan(60_000);
  });

  it("админ: actor=body.confectionerId, actor_is_admin=true", async () => {
    adminMock.mockResolvedValue(true);
    const res = await callPost({
      title: "Торт D1-админ",
      price: 2500,
      description: "Админская ветка D1",
      confectionerId: ADMIN_TARGET_ID,
    });
    expect(res.status).toBe(201);
    expect(state.setPriceCalls).toHaveLength(1);
    const { params } = state.setPriceCalls[0];
    expect(params[0]).toBe(ADMIN_TARGET_ID); // владелец, а не админ
    expect(params[3]).toBe(2500);
    expect(params[5]).toBe("initial");
    expect(params[7]).toBe("system");
    expect(params[10]).toBe(true); // p_actor_is_admin
  });

  it("best-effort: сбой set_product_price не ломает 201", async () => {
    state.setPriceErr = new Error("set_product_price: connection refused");
    const res = await callPost({ title: "Торт D1-сбой", price: 700, description: "История не критична" });
    expect(res.status).toBe(201);
    expect(state.setPriceCalls).toHaveLength(1); // попытка была
    const json = await res.json();
    expect(json.product?.id).toBe(PRODUCT_ID);
  });

  it("без вставки нет и истории: 422 (короткий title) → set_product_price не вызывался", async () => {
    const res = await callPost({ title: "Т", price: 1000 });
    expect(res.status).toBe(422);
    expect(state.insertedProducts).toHaveLength(0);
    expect(state.setPriceCalls).toHaveLength(0);
  });
});
