/**
 * route.test.ts — Z-v32 Этап 8 (PR-5): expiry-гварды PATCH /api/negotiations/[id].
 *
 * Лочит:
 *   • accept истёкшего предложения → 410 OFFER_EXPIRED (+ лениво status='expired');
 *   • accept валидного → revision-снимок change_reason='accepted' + фиксация;
 *   • accept без предложения → 409 OFFER_NO_PRICE;
 *   • чужие переговоры → 403;
 *   • quote = «recalculate & resend»: valid_until = now + 14д (дефолт) /
 *     кламп 60д (validDays=100), change_reason initial/price_adjustment;
 *   • quote по принятым переговорам → 409 (binding нельзя тихо переписать);
 *   • ЕДИНИЦЫ ЗАКРЕПЛЕНЫ: quotedPrice 250000 (копейки) → системное сообщение
 *     «Предложение: 2500₽» (деление на 100 — корректное отображение, НЕ баг).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const NEG_ID = "33333333-3333-4333-8333-333333333303";
const SIBLING_ID = "33333333-3333-4333-8333-333333333304";
const CUST_ID = "11111111-1111-4111-8111-111111111101";
const CONF_ID = "11111111-1111-4111-8111-111111111102";
const INQ_ID = "44444444-4444-4444-8444-444444444404";

type Row = Record<string, unknown>;

const state = {
  negotiations: new Map<string, Row>(),
  revisions: [] as Row[],
  messages: [] as Row[],
  inquiries: new Map<string, Row>(),
};

let authUser: { id: string; roles: string[] } = { id: CUST_ID, roles: ["CUSTOMER"] };

function resetDb(opts: { quoted_price: number | null; valid_until: string | null; status?: string } = { quoted_price: 250000, valid_until: null }) {
  state.negotiations.clear();
  state.revisions = [];
  state.messages = [];
  state.inquiries.clear();
  state.negotiations.set(NEG_ID, {
    id: NEG_ID,
    inquiry_id: INQ_ID,
    user_id: CUST_ID,
    confectioner_id: CONF_ID,
    quoted_price: opts.quoted_price,
    quoted_delivery_cost: 30000,
    quoted_prep_time: "2-3 дня",
    quoted_items: null,
    discount_percent: 0,
    discount_comment: null,
    status: opts.status ?? "quoted",
    valid_until: opts.valid_until,
    quoted_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });
  state.negotiations.set(SIBLING_ID, {
    id: SIBLING_ID,
    user_id: CUST_ID,
    confectioner_id: "55555555-5555-4555-8555-555555555505",
    quoted_price: 300000,
    status: "quoted",
    valid_until: null,
    inquiry_id: INQ_ID,
  });
  state.inquiries.set(INQ_ID, { id: INQ_ID, user_id: CUST_ID, status: "open" });
  authUser = { id: CUST_ID, roles: ["CUSTOMER"] };
}

function makeBuilder(table: string): unknown {
  let pendingWrite: { type: "insert" | "update"; payload: Row } | null = null;
  let filters: Array<{ col: string; kind: "eq" | "neq"; val: unknown }> = [];

  const rowsFor = (): Row[] => {
    if (table === "negotiations") return [...state.negotiations.values()];
    if (table === "inquiries") return [...state.inquiries.values()];
    if (table === "negotiation_revisions") return state.revisions;
    if (table === "negotiation_messages") return state.messages;
    return [];
  };
  const match = (r: Row): boolean =>
    filters.every((f) =>
      f.kind === "eq" ? r[f.col] === f.val : r[f.col] !== f.val
    );

  const compute = (): { data: unknown; error: null } => {
    if (pendingWrite?.type === "insert") {
      const p = pendingWrite.payload;
      if (table === "negotiation_revisions") state.revisions.push(p);
      else if (table === "negotiation_messages") state.messages.push(p);
      else if (table === "negotiations" && typeof p.id === "string") state.negotiations.set(p.id, p);
      return { data: p, error: null };
    }
    if (pendingWrite?.type === "update") {
      const updated: Row[] = [];
      if (table === "negotiations") {
        for (const [k, r] of state.negotiations) {
          if (match(r)) {
            const nr = { ...r, ...pendingWrite.payload };
            state.negotiations.set(k, nr);
            updated.push(nr);
          }
        }
      } else if (table === "inquiries") {
        for (const [k, r] of state.inquiries) {
          if (match(r)) {
            const nr = { ...r, ...pendingWrite.payload };
            state.inquiries.set(k, nr);
            updated.push(nr);
          }
        }
      }
      return { data: updated, error: null };
    }
    return { data: rowsFor().filter(match), error: null };
  };

  const api: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === "insert" || name === "update") {
      pendingWrite = { type: name, payload: args[0] as Row };
    }
    if (name === "eq") filters.push({ col: args[0] as string, kind: "eq", val: args[1] });
    if (name === "neq") filters.push({ col: args[0] as string, kind: "neq", val: args[1] });
    return api;
  };
  const firstOf = (r: { data: unknown }): unknown => {
    const arr = Array.isArray(r.data) ? r.data : [r.data];
    return (arr[0] as Row) ?? null;
  };
  Object.assign(api, {
    select: chain("select"),
    insert: chain("insert"),
    update: chain("update"),
    delete: chain("delete"),
    eq: chain("eq"),
    neq: chain("neq"),
    order: () => api,
    limit: () => api,
    single: () => {
      const r = compute();
      const row = firstOf(r);
      return Promise.resolve({ data: row, error: row ? null : { message: "PGRST116" } });
    },
    maybeSingle: () => {
      const r = compute();
      return Promise.resolve({ data: firstOf(r), error: null });
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
vi.mock("@/lib/supabase/auth", () => ({
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  forbiddenResponse: (message?: string) =>
    new Response(JSON.stringify({ error: message ?? "forbidden" }), { status: 403 }),
}));

import { PATCH } from "./route";

function patchReq(body: Record<string, unknown>): Promise<Response> {
  const req = new NextRequest("http://localhost/api/negotiations/x", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return PATCH(req, { params: Promise.resolve({ id: NEG_ID }) }) as unknown as Promise<Response>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetDb();
});

describe("PATCH /api/negotiations/[id] — Z-v32 expiry guards", () => {
  it("accept истёкшего предложения → 410 OFFER_EXPIRED + expiredAt + лениво status='expired'", async () => {
    const expiredAt = new Date(Date.now() - DAY_MS).toISOString();
    resetDb({ quoted_price: 250000, valid_until: expiredAt });

    const res = await patchReq({ action: "accept" });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string; expiredAt?: string };
    expect(body.error).toBe("OFFER_EXPIRED");
    expect(body.expiredAt).toBe(expiredAt);
    // Ленивый гард: статус честно помечен expired (cron не нужен)
    expect(state.negotiations.get(NEG_ID)?.status).toBe("expired");
    // Снимок 'accepted' НЕ записан, inquiry не закрыт
    expect(state.revisions).toHaveLength(0);
    expect(state.inquiries.get(INQ_ID)?.status).toBe("open");
  });

  it("accept истёкшего по статусу (status='expired', valid_until null) → 410", async () => {
    resetDb({ quoted_price: 250000, valid_until: null, status: "expired" });
    const res = await patchReq({ action: "accept" });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: string }).error).toBe("OFFER_EXPIRED");
  });

  it("accept валидного → 200, revision 'accepted' с ценой, inquiry→converted, сиблинг→declined", async () => {
    resetDb({ quoted_price: 250000, valid_until: new Date(Date.now() + 5 * DAY_MS).toISOString() });

    const res = await patchReq({ action: "accept" });
    expect(res.status).toBe(200);

    const neg = state.negotiations.get(NEG_ID);
    expect(neg?.status).toBe("accepted");
    expect(neg?.accepted_at).toBeTruthy();

    // Якорь binding: снимок ПРИНЯТОГО предложения
    expect(state.revisions).toHaveLength(1);
    expect(state.revisions[0]).toMatchObject({
      negotiation_id: NEG_ID,
      quoted_price: 250000,
      quoted_delivery_cost: 30000,
      changed_by: CUST_ID,
      change_reason: "accepted",
    });

    expect(state.inquiries.get(INQ_ID)?.status).toBe("converted");
    expect(state.negotiations.get(SIBLING_ID)?.status).toBe("declined");
  });

  it("accept без предложения (quoted_price null) → 409 OFFER_NO_PRICE", async () => {
    resetDb({ quoted_price: null, valid_until: null, status: "pending_confectioner" });
    const res = await patchReq({ action: "accept" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("OFFER_NO_PRICE");
    expect(state.negotiations.get(NEG_ID)?.status).toBe("pending_confectioner");
  });

  it("чужие переговоры → 403", async () => {
    authUser = { id: "99999999-9999-4999-8999-999999999999", roles: ["CUSTOMER"] };
    const res = await patchReq({ action: "accept" });
    expect(res.status).toBe(403);
  });

  it("quote (recalculate & resend) → revision 'price_adjustment', valid_until = now+14д (дефолт), сообщение в рублях", async () => {
    resetDb({ quoted_price: 200000, valid_until: new Date(Date.now() - DAY_MS).toISOString() });
    authUser = { id: CONF_ID, roles: ["CONFECTIONER"] };

    const before = Date.now();
    const res = await patchReq({ action: "quote", quotedPrice: 250000 }); // копейки
    expect(res.status).toBe(200);

    const neg = state.negotiations.get(NEG_ID);
    expect(neg?.status).toBe("quoted");
    expect(neg?.quoted_price).toBe(250000);
    // пересчёт по истёкшему: новый срок = момент отправки + 14 дней (±5с)
    const vu = new Date(neg?.valid_until as string).getTime();
    expect(vu).toBeGreaterThanOrEqual(before + 14 * DAY_MS - 5000);
    expect(vu).toBeLessThanOrEqual(Date.now() + 14 * DAY_MS + 5000);

    // prior-value snapshot предыдущего предложения
    expect(state.revisions).toHaveLength(1);
    expect(state.revisions[0]).toMatchObject({
      quoted_price: 200000,
      changed_by: CONF_ID,
      change_reason: "price_adjustment",
    });

    // ЕДИНИЦЫ ЗАКРЕПЛЕНЫ: 250000 копеек → «Предложение: 2500₽» (/100 — отображение, НЕ баг)
    expect(state.messages).toHaveLength(1);
    expect((state.messages[0].text as string).startsWith("Предложение: 2500₽")).toBe(true);
  });

  it("quote перве предложение → change_reason 'initial'; validDays=100 клампится до 60д", async () => {
    resetDb({ quoted_price: null, valid_until: null, status: "pending_confectioner" });
    authUser = { id: CONF_ID, roles: ["CONFECTIONER"] };

    const before = Date.now();
    const res = await patchReq({ action: "quote", quotedPrice: 250000, validDays: 100 });
    expect(res.status).toBe(200);
    expect(state.revisions[0]?.change_reason).toBe("initial");

    const vu = new Date(state.negotiations.get(NEG_ID)?.valid_until as string).getTime();
    expect(vu).toBeGreaterThanOrEqual(before + 60 * DAY_MS - 5000);
    expect(vu).toBeLessThanOrEqual(Date.now() + 60 * DAY_MS + 5000);
  });

  it("quote по принятым переговорам → 409 (зафиксированное предложение не переписывается)", async () => {
    resetDb({ quoted_price: 250000, valid_until: new Date(Date.now() + 5 * DAY_MS).toISOString() });
    state.negotiations.set(NEG_ID, { ...state.negotiations.get(NEG_ID)!, status: "accepted" });
    authUser = { id: CONF_ID, roles: ["CONFECTIONER"] };

    const res = await patchReq({ action: "quote", quotedPrice: 100000 });
    expect(res.status).toBe(409);
    expect(state.negotiations.get(NEG_ID)?.quoted_price).toBe(250000);
  });

  it("quote не-кондитером → 403", async () => {
    const res = await patchReq({ action: "quote", quotedPrice: 250000 });
    expect(res.status).toBe(403);
  });
});
