/**
 * route.test.ts — ZV33-4b D3: листинг заявок кондитера включает ПРИНЯТЫЕ
 * предложения (inquiry сконвертирован accept'ом, но карточка «Принято
 * покупателем» обязана оставаться в «Заявках из конструктора»).
 *
 * Лочит:
 *   • filter=available → open-заявки (как раньше) + заявки, где у ЭТОГО
 *     кондитера negotiation.status='accepted' (даже при inquiry.status='converted');
 *   • accepted-переговоры ДРУГИХ кондитеров не тянут чужие заявки;
 *   • форма ответа обратно совместима: { inquiries: [...] } с customer_name;
 *   • регресс: filter=own — только свои заявки; не-кондитер на available → 403.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const CF_MAIN = "11111111-1111-4111-8111-111111111101";
const CF_OTHER = "11111111-1111-4111-8111-111111111102";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const INQ_OPEN = "33333333-3333-4333-8333-333333333301";
const INQ_ACCEPTED = "33333333-3333-4333-8333-333333333302";
const INQ_OTHER_ACCEPTED = "33333333-3333-4333-8333-333333333303";
const NEG_MAIN_ACCEPTED = "44444444-4444-4444-8444-444444444401";
const NEG_OTHER_ACCEPTED = "44444444-4444-4444-8444-444444444402";

type Row = Record<string, unknown>;

const state = {
  inquiries: new Map<string, Row>(),
  negotiations: new Map<string, Row>(),
  profiles: new Map<string, Row>(),
};

let authUser: { id: string; roles: string[] } = {
  id: CF_MAIN,
  roles: ["CUSTOMER", "CONFECTIONER"],
};

function seed() {
  state.inquiries.clear();
  state.negotiations.clear();
  state.profiles.clear();

  state.inquiries.set(INQ_OPEN, {
    id: INQ_OPEN,
    user_id: CUSTOMER,
    event_type: "kids",
    servings: 12,
    city: "Москва",
    estimated_price: 350000,
    status: "open",
    submitted_at: "2026-11-12T10:00:00.000Z",
    negotiations: [
      { id: "neg-open-1", confectioner_id: CF_MAIN, status: "pending_confectioner" },
    ],
  });
  // Заявка с ПРИНЯТЫМ предложением главного кондитера (inquiry сконвертирован)
  state.inquiries.set(INQ_ACCEPTED, {
    id: INQ_ACCEPTED,
    user_id: CUSTOMER,
    event_type: "wedding",
    servings: 40,
    city: "Москва",
    estimated_price: 500000,
    status: "converted",
    submitted_at: "2026-11-10T09:00:00.000Z",
    negotiations: [
      { id: NEG_MAIN_ACCEPTED, confectioner_id: CF_MAIN, status: "accepted", quoted_price: 4500000 },
    ],
  });
  // ЧУЖАЯ accepted-заявка (принял другой кондитер) — главному не видна
  state.inquiries.set(INQ_OTHER_ACCEPTED, {
    id: INQ_OTHER_ACCEPTED,
    user_id: CUSTOMER,
    event_type: "birthday",
    servings: 8,
    city: "Тула",
    estimated_price: 100000,
    status: "converted",
    submitted_at: "2026-11-11T08:00:00.000Z",
    negotiations: [
      { id: NEG_OTHER_ACCEPTED, confectioner_id: CF_OTHER, status: "accepted" },
    ],
  });
  state.profiles.set(CUSTOMER, { id: CUSTOMER, name: "Ольга Демо" });
  // Отдельная таблица negotiations (второй запрос листинга D3 читает её)
  state.negotiations.set(NEG_MAIN_ACCEPTED, {
    id: NEG_MAIN_ACCEPTED,
    inquiry_id: INQ_ACCEPTED,
    user_id: CUSTOMER,
    confectioner_id: CF_MAIN,
    status: "accepted",
  });
  state.negotiations.set(NEG_OTHER_ACCEPTED, {
    id: NEG_OTHER_ACCEPTED,
    inquiry_id: INQ_OTHER_ACCEPTED,
    user_id: CUSTOMER,
    confectioner_id: CF_OTHER,
    status: "accepted",
  });
  authUser = { id: CF_MAIN, roles: ["CUSTOMER", "CONFECTIONER"] };
}

function makeBuilder(table: string): unknown {
  let filters: Array<{ col: string; kind: "eq" | "in"; val: unknown }> = [];

  const rowsFor = (): Row[] => {
    if (table === "inquiries") return [...state.inquiries.values()];
    if (table === "negotiations") return [...state.negotiations.values()];
    if (table === "profiles") return [...state.profiles.values()];
    return [];
  };
  const match = (r: Row): boolean =>
    filters.every((f) =>
      f.kind === "eq"
        ? r[f.col] === f.val
        : Array.isArray(f.val)
          ? (f.val as unknown[]).includes(r[f.col])
          : false
    );

  const compute = (): { data: unknown; error: null } => ({
    data: rowsFor().filter(match),
    error: null,
  });

  const api: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === "eq") filters.push({ col: args[0] as string, kind: "eq", val: args[1] });
    if (name === "in") filters.push({ col: args[0] as string, kind: "in", val: args[1] });
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
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
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
vi.mock("@/lib/supabase/auth", () => ({
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  forbiddenResponse: (message?: string) =>
    new Response(JSON.stringify({ error: message ?? "forbidden" }), { status: 403 }),
}));

import { GET } from "./route";

function getReq(url: string): Promise<Response> {
  const req = new NextRequest(`http://localhost${url}`, { method: "GET" });
  return GET(req) as unknown as Promise<Response>;
}

beforeEach(() => {
  seed();
});

describe("GET /api/inquiries — ZV33-4b D3 (accepted-заявки кондитера)", () => {
  it("filter=available: open-заявки + заявка с принятым предложением ЭТОГО кондитера", async () => {
    const res = await getReq("/api/inquiries?filter=available");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inquiries: Array<Record<string, unknown>>;
    };

    const ids = body.inquiries.map((r) => r.id);
    expect(ids).toContain(INQ_OPEN); // open — как раньше
    expect(ids).toContain(INQ_ACCEPTED); // accepted-переговоры этого кондитера
    expect(ids).not.toContain(INQ_OTHER_ACCEPTED); // чужое принятое — НЕ утекает

    // Обратно совместимая форма: embedded negotiations + enrich имени
    const accepted = body.inquiries.find((r) => r.id === INQ_ACCEPTED)!;
    expect(accepted.status).toBe("converted");
    expect(Array.isArray(accepted.negotiations)).toBe(true);
    expect((accepted.customer_name as string) || "").toBe("Ольга Демо");
    const own = (accepted.negotiations as Array<Record<string, unknown>>).find(
      (n) => n.confectioner_id === CF_MAIN
    );
    expect(own?.status).toBe("accepted");
  });

  it("фильтр accepted-заявок привязан к confectioner_id (другой кондитер видит своё)", async () => {
    authUser = { id: CF_OTHER, roles: ["CUSTOMER", "CONFECTIONER"] };
    const res = await getReq("/api/inquiries?filter=available");
    const body = (await res.json()) as { inquiries: Array<Record<string, unknown>> };
    const ids = body.inquiries.map((r) => r.id);
    expect(ids).toContain(INQ_OTHER_ACCEPTED); // своё принятое
    expect(ids).not.toContain(INQ_ACCEPTED); // чужое принятое — НЕ утекает
    // open-заявка возвращается всем кондитерам как «доступная» (маркетплейс-
    // семантика unchanged): у CF_OTHER на ней переговоров нет, но она open
    expect(ids).toContain(INQ_OPEN);
  });

  it("filter=own (покупатель) — только свои заявки, accepted-догрузка не выполняется", async () => {
    authUser = { id: CUSTOMER, roles: ["CUSTOMER"] };
    const res = await getReq("/api/inquiries");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inquiries: Array<Record<string, unknown>> };
    const ids = body.inquiries.map((r) => r.id).sort();
    expect(ids).toEqual([INQ_OPEN, INQ_ACCEPTED, INQ_OTHER_ACCEPTED]);
  });

  it("available без роли кондитера → 403", async () => {
    authUser = { id: CUSTOMER, roles: ["CUSTOMER"] };
    const res = await getReq("/api/inquiries?filter=available");
    expect(res.status).toBe(403);
  });
});
