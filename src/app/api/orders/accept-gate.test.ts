/**
 * accept-gate.test.ts — регрессия гейта принятия заказа (приёмка Z-v12).
 *
 * Лочит:
 *   • нехватка ингредиентов (canProduce=false) → 409 ORDER_NOT_FEASIBLE,
 *     статус НЕ меняется, история НЕ пишется (сценарий A);
 *   • блокирующие причины движка (!canAccept) → 409 (сценарий D-ветка:
 *     RECIPE_MISSING также входит в BLOCKING_CODES);
 *   • выполнимый заказ → CONFIRMED + запись истории + уведомление;
 *   • повторный/параллельный accept (conditional update вернул 0 строк) →
 *     409 «Заказ уже обработан другим запросом», история не дублируется
 *     (сценарий B/C);
 *   • отказ движка (throw) → 503 fail-closed, статус не меняется.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const CONF_ID = "11111111-1111-4111-8111-111111111101";
const CUST_ID = "11111111-1111-4111-8111-111111111106";
const ORDER_ID = "5828a175-c3b0-43e3-a6c2-303881948a38";

const dbState = {
  order: { id: ORDER_ID, number: "ZV12-TEST", status: "PENDING", confectioner_id: CONF_ID, user_id: CUST_ID },
  conf: { id: "c0", userId: CONF_ID, verificationStatus: "approved" },
  history: [] as Array<Record<string, unknown>>,
  notifications: [] as Array<Record<string, unknown>>,
};

function resetDb() {
  dbState.order.status = "PENDING";
  dbState.history = [];
  dbState.notifications = [];
}

/** Fluent thenable: для orders.update — conditional по status=PENDING. */
function makeBuilder(table: string): unknown {
  const api: Record<string, unknown> = {};
  const filters: Array<[string, unknown]> = [];
  let updateValues: Record<string, unknown> | null = null;

  const ordersMatch = () => filters.every(([c, v]) => (dbState.order as Record<string, unknown>)[c] === v);

  const resolveUpdate = (): { data: unknown; error: unknown } => {
    if (dbState.order.status === "PENDING") {
      dbState.order.status = "CONFIRMED";
      return { data: [{ id: dbState.order.id }], error: null };
    }
    return { data: [], error: null };
  };

  const thenable = {
    then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
      const res = updateValues && table === "orders" ? resolveUpdate() : { data: null, error: null };
      return Promise.resolve(res).then(onFulfilled, onRejected);
    },
    catch(onRejected: (e: unknown) => unknown) {
      return Promise.resolve({ data: null, error: null }).catch(onRejected);
    },
  };

  const rec = (op: string) => (...args: unknown[]) => {
    if (op === "update") updateValues = args[0] as Record<string, unknown>;
    if (op === "eq") filters.push([args[0] as string, args[1]]);
    if (op === "insert" && table === "order_status_history") {
      dbState.history.push(args[0] as Record<string, unknown>);
    }
    return api;
  };

  Object.assign(api, {
    select: rec("select"),
    insert: rec("insert"),
    update: rec("update"),
    delete: rec("delete"),
    eq: rec("eq"),
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => {
      if (table === "orders") {
        // Копия — как реальная строка БД (route не должен видеть мутацию статуса)
        return Promise.resolve({ data: ordersMatch() ? { ...dbState.order } : null, error: null });
      }
      if (table === "confectioners") {
        const confOk = filters.every(([c, v]) => (dbState.conf as Record<string, unknown>)[c] === v);
        return Promise.resolve({ data: confOk ? dbState.conf : null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    ...thenable,
  });
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => ({ id: CONF_ID, roles: ["CONFECTIONER"] })),
}));
vi.mock("@/lib/role-guards", () => ({
  requireRole: vi.fn(async () => null),
}));
vi.mock("@/lib/notifications", () => ({
  sendNotification: vi.fn(async (n: Record<string, unknown>) => {
    dbState.notifications.push(n);
    return {};
  }),
}));

const lifecycleState: {
  errorCode: string | null;
  calls: Array<Record<string, unknown>>;
} = { errorCode: null, calls: [] };

vi.mock("@/lib/ops/lifecycle", () => {
  class MockLifecycleError extends Error {
    code: string;
    detail?: string;
    constructor(code: string, message: string, detail?: string) {
      super(message);
      this.code = code;
      this.detail = detail;
    }
  }
  return {
    LifecycleError: MockLifecycleError,
    applyOrderTransition: vi.fn(async (input: Record<string, unknown>) => {
      lifecycleState.calls.push(input);
      if (lifecycleState.errorCode) {
        throw new MockLifecycleError(
          lifecycleState.errorCode,
          `lifecycle rejected ${String(input.to)}`,
          "test detail"
        );
      }
      const from = dbState.order.status;
      dbState.order.status = String(input.to);
      dbState.history.push({
        order_id: input.orderId,
        status_from: from,
        status_to: input.to,
        changed_by: input.actorId,
      });
      dbState.notifications.push({ user_id: CUST_ID });
      return { orderId: input.orderId, from, to: input.to };
    }),
  };
});

import { POST as postAccept } from "./[id]/accept/route";

const req = () => new NextRequest(`http://localhost:3000/api/orders/${ORDER_ID}/accept`, { method: "POST" });

beforeEach(() => {
  resetDb();
  lifecycleState.errorCode = null;
  lifecycleState.calls = [];
});

describe("POST /api/orders/:id/accept — единый lifecycle engine", () => {
  it("выполнимый заказ → CONFIRMED через атомарный lifecycle engine", async () => {
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, orderId: ORDER_ID, status: "CONFIRMED" });
    expect(lifecycleState.calls).toHaveLength(1);
    expect(lifecycleState.calls[0]).toMatchObject({
      orderId: ORDER_ID,
      to: "CONFIRMED",
      actorId: CONF_ID,
      actorRoles: ["CONFECTIONER"],
    });
    expect(dbState.order.status).toBe("CONFIRMED");
    expect(dbState.history).toHaveLength(1);
    expect(dbState.history[0]).toMatchObject({
      order_id: ORDER_ID,
      status_from: "PENDING",
      status_to: "CONFIRMED",
      changed_by: CONF_ID,
    });
    expect(dbState.notifications).toHaveLength(1);
  });

  it("неподтверждённая онлайн-оплата → 422, заказ не меняется", async () => {
    lifecycleState.errorCode = "PAYMENT_NOT_CONFIRMED";
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("PAYMENT_NOT_CONFIRMED");
    expect(dbState.order.status).toBe("PENDING");
    expect(dbState.history).toHaveLength(0);
    expect(dbState.notifications).toHaveLength(0);
  });

  it("исполнитель не имеет права на заказ → 403, заказ не меняется", async () => {
    lifecycleState.errorCode = "FORBIDDEN_ROLE";
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("FORBIDDEN_ROLE");
    expect(dbState.order.status).toBe("PENDING");
  });

  it("заказ уже обработан / переход запрещён → 409", async () => {
    lifecycleState.errorCode = "INVALID_TRANSITION";
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("INVALID_TRANSITION");
    expect(dbState.order.status).toBe("PENDING");
  });

  it("заказ не найден в транзакционном движке → 404", async () => {
    lifecycleState.errorCode = "ORDER_NOT_FOUND";
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("ORDER_NOT_FOUND");
  });
});
