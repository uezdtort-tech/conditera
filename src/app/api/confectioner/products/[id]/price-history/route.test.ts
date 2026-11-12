/**
 * Тесты D3 (PR-6A2): GET /api/confectioner/products/[id]/price-history —
 * семантика active/planned.
 *
 * Контракт:
 *   • current — АКТИВНАЯ версия (покрывает now: from <= now < to|∞);
 *     плановая будущая строка НЕ выдаётся за текущую;
 *   • planned — отдельное поле: открытая строка с from > now (последняя) или null;
 *   • items — без изменений (все версии DESC).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "b0000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "a0000000-0000-4000-8000-000000000001";
const ID_ACTIVE = "e0000000-0000-4000-8000-000000000001";
const ID_PLANNED = "e0000000-0000-4000-8000-000000000002";
const ID_CLOSED = "e0000000-0000-4000-8000-000000000003";

const { state, poolQueryMock, userMock, adminMock } = vi.hoisted(() => ({
  state: { historyRows: [] as unknown[] },
  poolQueryMock: vi.fn(),
  userMock: vi.fn(),
  adminMock: vi.fn(),
}));

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: poolQueryMock }),
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => userMock(...args),
}));
vi.mock("@/lib/role-guards", () => ({
  isAdmin: (...args: unknown[]) => adminMock(...args),
}));

function poolRouter(sql: string): { rows: unknown[] } {
  const q = sql.trim();
  if (/sync_effective_product_prices/.test(q)) return { rows: [] };
  if (/FROM public\.products WHERE id = \$1 AND deleted_at IS NULL/.test(q)) {
    return { rows: [{ id: PRODUCT_ID, confectioner_id: USER_ID }] };
  }
  if (/FROM public\.product_price_history/.test(q)) {
    return { rows: state.historyRows };
  }
  return { rows: [] };
}

import { GET } from "./route";

const NOW = Date.now();
const h = (ms: number) => new Date(NOW + ms).toISOString();
// rows приходят из БД в порядке effective_from DESC — тесты соблюдают это

function row(id: string, from: string, to: string | null, amount = 1000): Record<string, unknown> {
  return {
    id,
    amount,
    currency: "RUB",
    effective_from: from,
    effective_to: to,
    reason: "initial",
    comment: null,
    source: "system",
    previous_version_id: null,
    cost_snapshot_rub: null,
    created_by: USER_ID,
    created_at: from,
  };
}

async function callGet(): Promise<Response> {
  const request = new NextRequest(`http://localhost:3000/api/confectioner/products/${PRODUCT_ID}/price-history`);
  return GET(request, { params: Promise.resolve({ id: PRODUCT_ID }) });
}

beforeEach(() => {
  poolQueryMock.mockReset();
  poolQueryMock.mockImplementation((sql: string) => poolRouter(sql));
  userMock.mockReset();
  userMock.mockResolvedValue({ id: USER_ID });
  adminMock.mockReset();
  adminMock.mockResolvedValue(false);
  state.historyRows = [];
});

describe("GET price-history — D3 current=active, planned отдельно", () => {
  it("активная (закрыта на planned-границе) + плановая: current=активная, planned=отдельно", async () => {
    state.historyRows = [
      row(ID_PLANNED, h(+60 * 60_000), null, 1500), // плановая: from > now, открыта
      row(ID_ACTIVE, h(-60 * 60_000), h(+60 * 60_000), 1200), // активная: [past, future)
    ];
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.current).toMatchObject({ versionId: ID_ACTIVE, amount: 1200, planned: false });
    expect(json.planned).toMatchObject({ versionId: ID_PLANNED, amount: 1500 });
    expect(json.items).toHaveLength(2);
    expect(json.previous).toBeNull();
  });

  it("одна открытая строка в прошлом: current=она, planned=null (поведение 0083 сохранено)", async () => {
    state.historyRows = [row(ID_ACTIVE, h(-60 * 60_000), null, 1000)];
    const res = await callGet();
    const json = await res.json();
    expect(json.current).toMatchObject({ versionId: ID_ACTIVE, amount: 1000, planned: false });
    expect(json.planned).toBeNull();
    expect(json.items).toHaveLength(1);
  });

  it("только плановая строка (активной нет): current=null, planned=строка", async () => {
    state.historyRows = [row(ID_PLANNED, h(+60 * 60_000), null, 1500)];
    const res = await callGet();
    const json = await res.json();
    expect(json.current).toBeNull();
    expect(json.planned).toMatchObject({ versionId: ID_PLANNED, amount: 1500 });
  });

  it("закрытая историческая строка не становится current", async () => {
    state.historyRows = [
      row(ID_PLANNED, h(+60 * 60_000), null, 1500),
      row(ID_ACTIVE, h(-120 * 60_000), h(-60 * 60_000), 1200), // закрыта в прошлом
    ];
    const res = await callGet();
    const json = await res.json();
    expect(json.current).toBeNull();
    expect(json.planned).toMatchObject({ versionId: ID_PLANNED });
    expect(json.items).toHaveLength(2);
  });

  it("planned = последняя открытая будущая строка (first-match в DESC)", async () => {
    state.historyRows = [
      row("e0000000-0000-4000-8000-000000000005", h(+120 * 60_000), null, 1800),
      row(ID_PLANNED, h(+60 * 60_000), null, 1500),
      row(ID_ACTIVE, h(-60 * 60_000), h(+60 * 60_000), 1200),
    ];
    const res = await callGet();
    const json = await res.json();
    // rows DESC → первый открытый with from>now — самый поздний (rows[0])
    expect(json.planned).toMatchObject({ versionId: "e0000000-0000-4000-8000-000000000005", amount: 1800 });
    expect(json.current).toMatchObject({ versionId: ID_ACTIVE });
  });
});
