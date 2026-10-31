/**
 * Регрессия §3 «назначение кондитера» (P1):
 *
 * 1) POST /api/quotes — валидация целей: раньше ЛЮБЫЕ строки confectioner_ids
 *    сохранялись (несуществующие/неверифицированные), а уведомления писались
 *    с user_id: null (мёртвые письма). Лочит:
 *      a) несуществующий/неверифицированный id → 400, quote_request НЕ создан;
 *      b) verified-цель → 201 + notification с user_id = confectioners.userId;
 *      c) НЕТ notification с user_id: null.
 *
 * 2) POST /api/orders — тарифный снапшот: раньше confectioners искали по
 *    .eq("id", <uuid>) при TEXT-ключе 'c0'… → всегда мимо → tariff/commission
 *    snapshot null у всех заказов. Лочит: поиск по .eq("userId", …) + только
 *    approved; заказ несёт tariff_snapshot/commission_rate_snapshot.
 *
 * supabaseAdmin — записывающий fluent-mock (контракт вызовов, не SQL).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface CapturedCall {
  table: string;
  op: string;
  args: unknown[];
  result?: unknown;
}

const captured: CapturedCall[] = [];

// Управляемое «состояние БД» для мока
const dbState = {
  confectioners: [] as Array<Record<string, unknown>>,
  product: null as Record<string, unknown> | null,
};

/** Fluent thenable builder: пишет вызовы, применяет eq/in-фильтры к dbState. */
function makeBuilder(table: string): unknown {
  const state = { insertSeen: false, filters: [] as Array<[string, unknown]>, ins: null as unknown };
  const api: Record<string, unknown> = {};

  const applyFilters = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    rows.filter((r) =>
      state.filters.every(([col, val]) =>
        Array.isArray(val) ? val.includes(r[col]) : r[col] === val
      )
    );

  const resolve = (): { data: unknown; error: unknown } => {
    if (table === "confectioners") {
      return { data: applyFilters(dbState.confectioners), error: null };
    }
    if (table === "products") return { data: dbState.product, error: null };
    if (state.insertSeen) {
      if (table === "orders") return { data: { id: "order-1", number: "UK-2026-1" }, error: null };
      if (table === "quote_requests") return { data: { id: "qr-1" }, error: null };
    }
    return { data: null, error: null };
  };

  const thenable = {
    then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
    catch(onRejected: (e: unknown) => unknown) {
      return Promise.resolve(resolve()).catch(onRejected);
    },
  };
  const recordAndReturn = (op: string) => (...args: unknown[]) => {
    captured.push({ table, op, args });
    if (op === "insert") state.insertSeen = true;
    if (op === "eq") state.filters.push([args[0] as string, args[1]]);
    if (op === "in") state.filters.push([args[0] as string, args[1]]);
    return api;
  };
  Object.assign(api, {
    select: recordAndReturn("select"),
    insert: recordAndReturn("insert"),
    update: recordAndReturn("update"),
    delete: recordAndReturn("delete"),
    eq: recordAndReturn("eq"),
    in: recordAndReturn("in"),
    contains: recordAndReturn("contains"),
    gte: recordAndReturn("gte"),
    order: recordAndReturn("order"),
    limit: recordAndReturn("limit"),
    maybeSingle: () => {
      const { data } = resolve();
      const arr = Array.isArray(data) ? data : data ? [data as Record<string, unknown>] : [];
      return Promise.resolve({ data: arr[0] ?? null, error: null });
    },
    single: () => {
      const { data } = resolve();
      const arr = Array.isArray(data) ? data : data ? [data as Record<string, unknown>] : [];
      return Promise.resolve({ data: arr[0] ?? null, error: null });
    },
    ...thenable,
  });
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));

// ===== Quotes =====
const QUOTE_USER = { userId: "user-1", id: "user-1", roles: ["CUSTOMER"], name: "Анна" };

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async (...args: unknown[]) => {
    // Оба маршрута мокаются одним модулем: различаем по URL запроса
    const req = args[0] as Request;
    return req.url.includes("/api/orders") ? ORDERS_USER : QUOTE_USER;
  }),
}));

vi.mock("@/lib/http-helpers", async (importOriginal) => {
  return importOriginal();
});

vi.mock("@/lib/n8n", () => ({ emitEvent: vi.fn(async () => ({})) }));
vi.mock("@/lib/ops/events", () => ({ recordEvent: vi.fn(async () => ({})) }));
vi.mock("@/lib/anti-fraud", () => ({
  checkFraudLimit: vi.fn(async () => ({ allowed: true, resetAt: Date.now() + 1000 })),
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
  getClientIP: () => "127.0.0.1",
  RATE_LIMITS: { orders: { limit: 10, windowMs: 60_000 } },
}));
vi.mock("@/lib/yandex-metrika", () => ({ trackEventServer: vi.fn(async () => ({})) }));

import { POST as postQuote } from "../quotes/route";
import { POST as postOrder } from "../orders/route";

const ORDERS_USER = { userId: "user-1", id: "user-1", roles: ["CUSTOMER"], name: "Анна" };

const BASE = "http://localhost:3000";

function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VERIFIED_CONF = { id: "c0", userId: "uuid-conf-1", businessName: "Сахарная печать", verified: true };
const PID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  captured.length = 0;
  dbState.confectioners = [];
  dbState.product = null;
});

describe("POST /api/quotes — валидация confectioner_ids и живые уведомления", () => {
  const validBody = {
    product_type: "cake",
    city: "Москва",
    confectioner_ids: ["c0"],
    servings: 8,
  };

  it("несуществующий кондитер → 400, quote_request НЕ создаётся", async () => {
    dbState.confectioners = [];
    const res = await postQuote(jsonReq(`${BASE}/api/quotes`, validBody));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("недоступны");
    expect(captured.some((c) => c.table === "quote_requests" && c.op === "insert")).toBe(false);
  });

  it("verified-кондитер → 201 + notification по userId (не null)", async () => {
    dbState.confectioners = [VERIFIED_CONF];
    const res = await postQuote(jsonReq(`${BASE}/api/quotes`, validBody));
    expect(res.status).toBe(201);

    const notif = captured.find((c) => c.table === "notifications" && c.op === "insert");
    expect(notif).toBeDefined();
    expect((notif!.args[0] as Record<string, unknown>).user_id).toBe("uuid-conf-1");
    expect(captured.some((c) => c.table === "notifications" && c.op === "insert" && (c.args[0] as Record<string, unknown>).user_id === null)).toBe(false);
  });

  it("неверифицированный кондитер → 400 (verified-фильтр)", async () => {
    dbState.confectioners = [{ ...VERIFIED_CONF, verified: false }];
    const res = await postQuote(jsonReq(`${BASE}/api/quotes`, validBody));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/orders — тарифный снапшот кондитера", () => {
  it("снапшот ищется по userId + approved; заказ несёт tariff/commission", async () => {
    dbState.product = { id: PID, title: "Медовик", price: 1800, images: ["a.png"], confectioner_id: "uuid-conf-1" };
    dbState.confectioners = [{ id: "c0", userId: "uuid-conf-1", tariff: "PREMIUM", legalInfo: { status: "NPD" }, verificationStatus: "approved" }];

    const res = await postOrder(
      jsonReq(`${BASE}/api/orders`, {
        items: [{ productId: PID, quantity: 2 }],
        deliveryAddress: "г. Москва, ул. Тверская 1",
        deliveryCost: 0,
      })
    );
    expect(res.status).toBe(201);

    // Поиск confectioners: .eq("userId", …) и .eq("verificationStatus", "approved")
    const confCalls = captured.filter((c) => c.table === "confectioners");
    expect(confCalls.some((c) => c.op === "eq" && c.args[0] === "userId" && c.args[1] === "uuid-conf-1")).toBe(true);
    expect(confCalls.some((c) => c.op === "eq" && c.args[0] === "verificationStatus" && c.args[1] === "approved")).toBe(true);
    // Регрессия: НЕ ищем по TEXT-колонке id с uuid
    expect(confCalls.some((c) => c.op === "eq" && c.args[0] === "id")).toBe(false);

    const orderInsert = captured.find((c) => c.table === "orders" && c.op === "insert");
    expect(orderInsert).toBeDefined();
    const payload = orderInsert!.args[0] as Record<string, unknown>;
    expect(payload.tariff_snapshot).toBe("PREMIUM");
    expect(payload.commission_rate_snapshot).toBe(0.05);
    expect(payload.legal_status_snapshot).toBe("NPD");
    expect(payload.confectioner_id).toBe("uuid-conf-1");
  });

  it("не-approved кондитер → null-снапшоты (заказ создаётся, payout-math возьмёт дефолт)", async () => {
    dbState.product = { id: PID, title: "Медовик", price: 1800, images: [], confectioner_id: "uuid-conf-2" };
    dbState.confectioners = []; // approved-строки нет

    const res = await postOrder(
      jsonReq(`${BASE}/api/orders`, {
        items: [{ productId: PID, quantity: 1 }],
        deliveryCost: 0,
      })
    );
    expect(res.status).toBe(201);
    const orderInsert = captured.find((c) => c.table === "orders" && c.op === "insert")!;
    const payload = orderInsert.args[0] as Record<string, unknown>;
    expect(payload.tariff_snapshot).toBeNull();
    expect(payload.commission_rate_snapshot).toBeNull();
  });
});
