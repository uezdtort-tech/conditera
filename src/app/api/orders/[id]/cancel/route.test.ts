/**
 * route.test.ts — ZV33-8b FIX 2: POST /api/orders/[id]/cancel ставит
 * orders.cancelled_at (раньше UI-отмена оставляла NULL, хотя PATCH-путь
 * статусов пишет cancelled_at — см. ../route.ts newStatus === "CANCELLED").
 *
 * Лочит:
 *   • CAS-update payload: status CANCELLED + cancelled_at (ISO) + updated_at;
 *   • конкурентная смена статуса → 409, history НЕ пишется;
 *   • повторная отмена (уже CANCELLED) → 400;
 *   • history-вставка с атрибуцией актора (status_from → CANCELLED).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ORDER_ID = "55555555-5555-4555-8555-555555555505";
const USER_ID = "11111111-1111-4111-8111-111111111106";

type Row = Record<string, unknown>;

const state = {
  order: {
    id: ORDER_ID,
    number: "UK-2026-000001",
    status: "PENDING",
    user_id: USER_ID,
    payment_status: "pending",
    total: 1500,
    payout_reserved_at: null,
    payout_request_id: null,
  } as Row,
  /** Результат CAS-update: непустой массив = строка обновлена. */
  updatedRows: [{ id: ORDER_ID }],
  updatePayload: null as Row | null,
  history: [] as Row[],
};

let authUser: { id: string; roles: string[] } = { id: USER_ID, roles: ["CUSTOMER"] };
let adminFlag = false;

function makeBuilder(table: string): unknown {
  let pendingWrite: { type: "insert" | "update"; payload: Row } | null = null;
  let filters: Array<{ col: string; kind: "eq"; val: unknown }> = [];

  const compute = (): { data: unknown; error: null } => {
    if (pendingWrite?.type === "update" && table === "orders") {
      state.updatePayload = pendingWrite.payload;
      // CAS: возвращаем только «обновлённые» строки (state.updatedRows)
      const casOk = filters.every(
        (f) => f.kind === "eq" && state.order[f.col] === f.val
      );
      return { data: casOk ? state.updatedRows : [], error: null };
    }
    if (pendingWrite?.type === "insert" && table === "order_status_history") {
      state.history.push(pendingWrite.payload);
      return { data: pendingWrite.payload, error: null };
    }
    if (table === "orders") return { data: [state.order], error: null };
    if (table === "payments") return { data: [], error: null };
    return { data: [], error: null };
  };

  const api: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === "insert" || name === "update") {
      pendingWrite = { type: name, payload: args[0] as Row };
    }
    if (name === "eq") filters.push({ col: args[0] as string, kind: "eq", val: args[1] });
    return api;
  };
  Object.assign(api, {
    select: chain("select"),
    insert: chain("insert"),
    update: chain("update"),
    delete: chain("delete"),
    eq: chain("eq"),
    in: chain("in"),
    order: () => api,
    limit: () => api,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => {
      const r = compute();
      const arr = Array.isArray(r.data) ? (r.data as Row[]) : [];
      return Promise.resolve({ data: arr[0] ?? null, error: null });
    },
    then: (
      onFulfilled: (v: { data: unknown; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => Promise.resolve(compute()).then(onFulfilled, onRejected),
    catch: (onRejected: (e: unknown) => unknown) =>
      Promise.resolve(compute()).catch(onRejected),
  });
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => authUser),
}));
vi.mock("@/lib/role-guards", () => ({
  isAdmin: vi.fn(async () => adminFlag),
}));
vi.mock("@/lib/n8n", () => ({
  emitEvent: vi.fn(async () => ({})),
}));
vi.mock("@/lib/http-helpers", () => ({
  handleRouteError: vi.fn(
    () =>
      new Response(JSON.stringify({ error: "internal" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
  ),
}));

import { POST } from "./route";

function cancelReq(): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/orders/${ORDER_ID}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Передумал" }),
    headers: { "content-type": "application/json" },
  });
  return POST(req, { params: Promise.resolve({ id: ORDER_ID }) }) as unknown as Promise<Response>;
}

beforeEach(() => {
  state.order = {
    id: ORDER_ID,
    number: "UK-2026-000001",
    status: "PENDING",
    user_id: USER_ID,
    payment_status: "pending",
    total: 1500,
    payout_reserved_at: null,
    payout_request_id: null,
  };
  state.updatedRows = [{ id: ORDER_ID }];
  state.updatePayload = null;
  state.history = [];
  authUser = { id: USER_ID, roles: ["CUSTOMER"] };
  adminFlag = false;
});

describe("POST /api/orders/[id]/cancel — ZV33-8b FIX 2 (cancelled_at)", () => {
  it("успешная отмена: update payload несёт status CANCELLED + cancelled_at + updated_at", async () => {
    const res = await cancelReq();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe("CANCELLED");

    // FIX 2: cancelled_at проставлен (раньше NULL после UI-отмены)
    expect(state.updatePayload).toMatchObject({
      status: "CANCELLED",
      cancelled_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(new Date(state.updatePayload!.cancelled_at as string).getTime()).not.toBeNaN();

    // History с атрибуцией актора
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({
      order_id: ORDER_ID,
      status_from: "PENDING",
      status_to: "CANCELLED",
      changed_by: USER_ID,
      comment: "Передумал",
    });
  });

  it("CAS-конфликт (статус изменился конкурентно) → 409, без history", async () => {
    state.updatedRows = []; // UPDATE не поймал ни одной строки
    const res = await cancelReq();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("Статус заказа изменился");
    expect(state.history).toHaveLength(0);
  });

  it("повторная отмена уже отменённого заказа → 400", async () => {
    state.order = { ...state.order, status: "CANCELLED" };
    const res = await cancelReq();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("CANCELLED");
    expect(state.updatePayload).toBeNull();
  });
});
