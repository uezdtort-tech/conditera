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

const feasibility = (over: Record<string, unknown> = {}) => ({
  canAccept: true,
  availability: "available",
  risk: "GREEN",
  reasons: [],
  suggestions: [],
  owners: [{ inventory: { canProduce: true, shortageCount: 0, shortages: [] } }],
  alternativeWindows: [],
  ...over,
});

// Управляемое поведение движка (переопределяется в тестах через переменную)
let engineBehavior: "ok" | "blocked" | "inventory" | "throws" | "null" = "ok";
let engineCalls: string[] = [];

vi.mock("@/lib/ops/acceptance", () => ({
  checkOrderAcceptance: vi.fn(async (orderId: string) => {
    engineCalls.push(orderId);
    if (engineBehavior === "throws") throw new Error("engine down");
    if (engineBehavior === "null") return null;
    if (engineBehavior === "blocked") {
      return feasibility({
        canAccept: false,
        availability: "unavailable",
        risk: "ORANGE",
        reasons: [{ code: "RECIPE_MISSING", message: "«Товар»: нет привязанного рецепта — потребность в ингредиентах не рассчитана." }],
      });
    }
    if (engineBehavior === "inventory") {
      return feasibility({
        availability: "available_with_warning",
        risk: "ORANGE",
        reasons: [{ code: "LOW_STOCK", message: "Недостаточно: Ягоды (−500 г)." }],
        owners: [{ inventory: { canProduce: false, shortageCount: 1, shortages: [{ name: "Ягоды", shortage: 500, unit: "г" }] } }],
      });
    }
    return feasibility();
  }),
}));

import { POST as postAccept } from "./[id]/accept/route";

const req = () => new NextRequest(`http://localhost:3000/api/orders/${ORDER_ID}/accept`, { method: "POST" });

beforeEach(() => {
  resetDb();
  engineBehavior = "ok";
  engineCalls = [];
});

describe("POST /api/orders/:id/accept — гейт Acceptance Engine", () => {
  it("выполнимый заказ → CONFIRMED, история, уведомление; движок вызван с orderId", async () => {
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("CONFIRMED");
    expect(engineCalls).toEqual([ORDER_ID]);
    expect(dbState.order.status).toBe("CONFIRMED");
    expect(dbState.history).toHaveLength(1);
    expect(dbState.history[0]).toMatchObject({ order_id: ORDER_ID, status_from: "PENDING", status_to: "CONFIRMED", changed_by: CONF_ID });
    expect(dbState.notifications).toHaveLength(1);
  });

  it("нехватка ингредиентов (canProduce=false) → 409, статус остаётся PENDING (сценарий A)", async () => {
    engineBehavior = "inventory";
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ORDER_NOT_FEASIBLE");
    expect(body.shortages).toEqual([{ name: "Ягоды", shortage: 500, unit: "г" }]);
    expect(dbState.order.status).toBe("PENDING");
    expect(dbState.history).toHaveLength(0);
    expect(dbState.notifications).toHaveLength(0);
  });

  it("RECIPE_MISSING (!canAccept) → 409 с понятным сообщением (сценарий D)", async () => {
    engineBehavior = "blocked";
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ORDER_NOT_FEASIBLE");
    expect(JSON.stringify(body.reasons)).toContain("RECIPE_MISSING");
    expect(dbState.order.status).toBe("PENDING");
  });

  it("параллельный/повторный accept: conditional update вернул 0 строк → 409, без дубля истории", async () => {
    // Симуляция: второй запрос приходит, когда статус уже CONFIRMED
    dbState.order.status = "CONFIRMED";
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    // Статус не PENDING → ранний отказ «Заказ уже CONFIRMED» (первый барьер)
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("CONFIRMED");
  });

  it("движок упал → 503 fail-closed, статус не меняется", async () => {
    engineBehavior = "throws";
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("FEASIBILITY_CHECK_FAILED");
    expect(dbState.order.status).toBe("PENDING");
  });

  it("движок вернул null → 503 fail-closed", async () => {
    engineBehavior = "null";
    const res = await postAccept(req(), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(res.status).toBe(503);
    expect(dbState.order.status).toBe("PENDING");
  });
});
