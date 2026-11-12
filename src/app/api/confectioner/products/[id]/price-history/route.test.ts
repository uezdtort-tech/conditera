/**
 * Тесты GET /api/confectioner/products/[id]/price-history
 *
 * Покрытие: owner 200 (items + delta-математика), чужой кондитер 403,
 * admin 200, catch-up (sync_effective_product_prices) вызывается ДО чтения
 * истории, planned-версия (effective_from > now) → planned:true.
 *
 * Мок-паттерн — как в admin/dashboard/route.test.ts: vi.mock + vi.hoisted,
 * pool.query маршрутизируется по SQL-паттернам.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const PRODUCT_ID = "a0000000-0000-4000-8000-000000000001";
const OWNER_ID = "c0000000-0000-4000-8000-000000000001";
const OTHER_ID = "c0000000-0000-4000-8000-000000000002";

const { state, poolQueryMock, userMock, adminMock } = vi.hoisted(() => ({
  state: {
    productRows: [] as unknown[],
    historyRows: [] as unknown[],
  },
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

function router(sql: string): { rows: unknown[] } {
  if (/sync_effective_product_prices/.test(sql)) return { rows: [{ sync: 0 }] };
  if (/deleted_at IS NULL/.test(sql)) return { rows: state.productRows };
  if (/FROM public\.product_price_history/.test(sql)) return { rows: state.historyRows };
  return { rows: [] };
}

function historyRow(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    amount: 5000,
    currency: "RUB",
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: null,
    reason: "ingredients",
    comment: null,
    source: "confectioner_ui",
    previous_version_id: null,
    cost_snapshot_rub: null,
    created_by: OWNER_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

import { GET } from "./route";

async function callGet(query = ""): Promise<Response> {
  const request = new NextRequest(
    `http://localhost:3000/api/confectioner/products/${PRODUCT_ID}/price-history${query}`
  );
  return GET(request, { params: Promise.resolve({ id: PRODUCT_ID }) });
}

beforeEach(() => {
  poolQueryMock.mockReset();
  poolQueryMock.mockImplementation((sql: string) => router(sql));
  userMock.mockReset();
  userMock.mockResolvedValue({ id: OWNER_ID, userId: OWNER_ID });
  adminMock.mockReset();
  adminMock.mockResolvedValue(false);
  state.productRows = [{ id: PRODUCT_ID, confectioner_id: OWNER_ID }];
  state.historyRows = [];
});

describe("GET /api/confectioner/products/[id]/price-history", () => {
  it("владелец: 200, current/previous + delta-математика по хронологии", async () => {
    state.historyRows = [
      // DESC как из SQL (idx_product_price_history_lookup)
      historyRow({
        id: "e0000000-0000-4000-8000-000000000002",
        amount: 6500,
        effective_from: "2026-02-01T00:00:00.000Z",
        previous_version_id: "e0000000-0000-4000-8000-000000000001",
        cost_snapshot_rub: 1200,
      }),
      historyRow({ amount: 5000 }),
    ];

    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.current).toEqual({
      versionId: "e0000000-0000-4000-8000-000000000002",
      amount: 6500,
      currency: "RUB",
      effectiveFrom: "2026-02-01T00:00:00.000Z",
      planned: false,
    });
    expect(json.previous).toEqual({ amount: 5000, effectiveFrom: "2026-01-01T00:00:00.000Z" });

    expect(json.items).toHaveLength(2);
    // items DESC: v2 (6500) первой — дельта против v1 (5000): +1500 = +30%
    expect(json.items[0]).toMatchObject({
      id: "e0000000-0000-4000-8000-000000000002",
      amount: 6500,
      deltaRub: 1500,
      deltaPercent: 30,
      costSnapshotRub: 1200,
      previousVersionId: "e0000000-0000-4000-8000-000000000001",
    });
    // самая старая строка — без дельты
    expect(json.items[1]).toMatchObject({
      id: "e0000000-0000-4000-8000-000000000001",
      amount: 5000,
      deltaRub: null,
      deltaPercent: null,
    });
  });

  it("чужой кондитер (не владелец, не админ): 403", async () => {
    userMock.mockResolvedValue({ id: OTHER_ID, userId: OTHER_ID });
    const res = await callGet();
    expect(res.status).toBe(403);
  });

  it("ADMIN: 200 даже когда не владелец", async () => {
    userMock.mockResolvedValue({ id: OTHER_ID, userId: OTHER_ID });
    adminMock.mockResolvedValue(true);
    state.historyRows = [historyRow({})];
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.current.amount).toBe(5000);
  });

  it("catch-up (sync_effective_product_prices) вызван ДО чтения истории", async () => {
    state.historyRows = [historyRow({})];
    await callGet();
    const calls = poolQueryMock.mock.calls as Array<[string]>;
    const syncIdx = calls.findIndex(([sql]) => /sync_effective_product_prices/.test(sql));
    const readIdx = calls.findIndex(([sql]) => /FROM public\.product_price_history/.test(sql));
    expect(syncIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(syncIdx);
  });

  it("planned-версия (effective_from в будущем): planned:true, previous — предшественник", async () => {
    state.historyRows = [
      historyRow({
        id: "e0000000-0000-4000-8000-000000000003",
        amount: 7000,
        effective_from: "2099-01-01T00:00:00.000Z",
        previous_version_id: "e0000000-0000-4000-8000-000000000001",
      }),
      historyRow({ amount: 5000 }),
    ];
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.current.planned).toBe(true);
    expect(json.current.amount).toBe(7000);
    expect(json.previous).toEqual({ amount: 5000, effectiveFrom: "2026-01-01T00:00:00.000Z" });
  });

  it("неавторизованный: 401", async () => {
    userMock.mockResolvedValue(null);
    const res = await callGet();
    expect(res.status).toBe(401);
  });
});
