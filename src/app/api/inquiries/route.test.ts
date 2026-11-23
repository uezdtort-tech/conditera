/**
 * route.test.ts — ZV33-4b D3: листинг заявок кондитера включает ПРИНЯТЫЕ
 * предложения (inquiry сконвертирован accept'ом, но карточка «Принято
 * покупателем» обязана оставаться в «Заявках из конструктора»).
 *
 * Версия под канонический PG-контракт (withClaims + client.query):
 *   • filter=available → SQL содержит OR EXISTS ... acc_n.status='accepted'
 *     с изоляцией по confectioner_id = параметр user.id;
 *   • ответ обратно совместим: { inquiries: [...] } с вложенными negotiations;
 *   • регресс: filter=own — без accepted-догрузки; не-кондитер на available → 403.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const CF_MAIN = "11111111-1111-4111-8111-111111111101";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const INQ_OPEN = "33333333-3333-4333-8333-333333333301";
const INQ_ACCEPTED = "33333333-3333-4333-8333-333333333302";
const NEG_MAIN_ACCEPTED = "44444444-4444-4444-8444-444444444401";

type Row = Record<string, unknown>;

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

const state = {
  inquiryRows: [] as Row[],
  negotiationRows: [] as Row[],
  captured: [] as CapturedQuery[],
};

let authUser: { id: string; roles: string[] } = {
  id: CF_MAIN,
  roles: ["CUSTOMER", "CONFECTIONER"],
};

function seed() {
  state.inquiryRows = [
    { id: INQ_OPEN, user_id: CUSTOMER, city: "Москва", status: "open", submitted_at: "2026-11-12T10:00:00.000Z" },
    // Заявка с ПРИНЯТЫМ предложением главного кондитера (inquiry сконвертирован)
    { id: INQ_ACCEPTED, user_id: CUSTOMER, city: "Москва", status: "converted", submitted_at: "2026-11-10T09:00:00.000Z" },
  ];
  state.negotiationRows = [
    { id: NEG_MAIN_ACCEPTED, inquiry_id: INQ_ACCEPTED, confectioner_id: CF_MAIN, status: "accepted", quoted_price: 4500000 },
  ];
  state.captured = [];
  authUser = { id: CF_MAIN, roles: ["CUSTOMER", "CONFECTIONER"] };
}

const fakeClient = {
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    state.captured.push({ sql, params: params || [] });
    // Порядок важен: SQL листинга содержит подзапрос по negotiations
    // (D3 OR EXISTS), поэтому inquiries проверяем ПЕРВЫМ.
    if (sql.includes("FROM public.inquiries")) {
      return { rows: state.inquiryRows };
    }
    if (sql.includes("FROM public.negotiations")) {
      return { rows: state.negotiationRows };
    }
    return { rows: [] };
  }),
};

vi.mock("@/lib/postgrest/execute", () => ({
  withClaims: vi.fn(
    async <T>(_claims: unknown, fn: (client: typeof fakeClient) => Promise<T>): Promise<T> => fn(fakeClient)
  ),
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => authUser),
}));

import { GET } from "./route";

function getReq(url: string): Promise<Response> {
  const req = new NextRequest(`http://localhost${url}`, { method: "GET" });
  return GET(req) as unknown as Promise<Response>;
}

beforeEach(() => {
  seed();
});

describe("GET /api/inquiries — ZV33-4b D3 на каноническом PG-контракте", () => {
  it("filter=available: SQL догружает accepted-заявки ЭТОГО кондитера, ответ содержит сконвертированную заявку с переговорами", async () => {
    const res = await getReq("/api/inquiries?filter=available");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inquiries: Array<Row & { negotiations?: Row[] }> };
    // D3: сконвертированная заявка с принятым предложением ЭТОГО кондитера
    // остаётся в листинге вместе с вложенными переговорами.
    const accepted = body.inquiries.find((i) => i.id === INQ_ACCEPTED);
    expect(accepted).toBeDefined();
    expect(accepted?.status).toBe("converted");
    expect(
      (accepted?.negotiations || []).some((n) => n.status === "accepted" && n.confectioner_id === CF_MAIN)
    ).toBe(true);
  });

  it("accepted-догрузка изолирована по confectioner_id (параметр = user.id)", async () => {
    await getReq("/api/inquiries?filter=available");
    const listing = state.captured.find((q) => q.sql.includes("FROM public.inquiries"));
    expect(listing).toBeDefined();
    // OR EXISTS ... acc_n.status = 'accepted' присутствует в доступе-фильтре
    expect(listing!.sql).toContain("OR EXISTS");
    expect(listing!.sql).toContain("acc_n.status = 'accepted'");
    // confectioner_id параметризован, а не конкатенирован: в SQL есть $N::uuid
    expect(listing!.sql).toMatch(/acc_n\.confectioner_id = \$\d+::uuid/);
    // и соответствующий параметр — id ТЕКУЩЕГО пользователя
    expect(listing!.params).toContain(CF_MAIN);
  });

  it("filter=own (покупатель) — только свои заявки, accepted-догрузка не выполняется", async () => {
    authUser = { id: CUSTOMER, roles: ["CUSTOMER"] };
    const res = await getReq("/api/inquiries?filter=own");
    expect(res.status).toBe(200);
    const listing = state.captured.find((q) => q.sql.includes("FROM public.inquiries"));
    expect(listing!.sql).toContain("i.user_id = $1::uuid");
    expect(listing!.sql).not.toContain("OR EXISTS");
    expect(listing!.sql).not.toContain("acc_n.status = 'accepted'");
  });

  it("available без роли кондитера → 403", async () => {
    authUser = { id: CUSTOMER, roles: ["CUSTOMER"] };
    const res = await getReq("/api/inquiries?filter=available");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("кондитеры");
  });
});
