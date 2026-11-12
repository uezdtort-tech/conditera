/**
 * Тесты GET /api/confectioner/products/[id]/price-at?date=...
 *
 * Покрытие: date-only интерпретируется как 12:00 Europe/Moscow (константа
 * цеха), полный ISO передаётся как есть, невалидная/отсутствующая дата → 400.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const PRODUCT_ID = "a0000000-0000-4000-8000-000000000001";
const OWNER_ID = "c0000000-0000-4000-8000-000000000001";

const { state, poolQueryMock, userMock, adminMock } = vi.hoisted(() => ({
  state: {
    productRows: [] as unknown[],
    priceAtRows: [] as unknown[],
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
  if (/deleted_at IS NULL/.test(sql)) return { rows: state.productRows };
  if (/get_product_price_at/.test(sql)) return { rows: state.priceAtRows };
  return { rows: [] };
}

import { GET } from "./route";

async function callGet(date?: string): Promise<Response> {
  const qs = date === undefined ? "" : `?date=${encodeURIComponent(date)}`;
  const request = new NextRequest(
    `http://localhost:3000/api/confectioner/products/${PRODUCT_ID}/price-at${qs}`
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
  state.priceAtRows = [
    {
      version_id: "e0000000-0000-4000-8000-000000000001",
      amount: 5000,
      currency: "RUB",
      effective_from: "2026-01-01T00:00:00.000Z",
      reason: "ingredients",
    },
  ];
});

describe("GET /api/confectioner/products/[id]/price-at", () => {
  it("date-only '2026-05-10' → 12:00 Europe/Moscow (= 09:00Z), ответ-маппинг", async () => {
    const res = await callGet("2026-05-10");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      amount: 5000,
      currency: "RUB",
      versionId: "e0000000-0000-4000-8000-000000000001",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      reason: "ingredients",
      approximate: false,
    });

    const calls = poolQueryMock.mock.calls as Array<[string, unknown[]]>;
    const atCall = calls.find(([sql]) => /get_product_price_at/.test(sql));
    expect(atCall).toBeDefined();
    // 2026-05-10T12:00:00+03:00 === 2026-05-10T09:00:00.000Z
    expect(atCall![1][1]).toBe("2026-05-10T09:00:00.000Z");
  });

  it("полный ISO передаётся как есть", async () => {
    const res = await callGet("2026-05-10T15:30:00Z");
    expect(res.status).toBe(200);
    const calls = poolQueryMock.mock.calls as Array<[string, unknown[]]>;
    const atCall = calls.find(([sql]) => /get_product_price_at/.test(sql));
    expect(atCall![1][1]).toBe(new Date("2026-05-10T15:30:00Z").toISOString());
  });

  it("невалидная дата → 400 INVALID_DATE", async () => {
    const res = await callGet("31.12.2026");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_DATE");
  });

  it("отсутствующий date → 400 INVALID_DATE", async () => {
    const res = await callGet();
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_DATE");
  });

  it("чужой кондитер: 403", async () => {
    userMock.mockResolvedValue({ id: "c0000000-0000-4000-8000-000000000002", userId: "c0000000-0000-4000-8000-000000000002" });
    const res = await callGet("2026-05-10");
    expect(res.status).toBe(403);
  });
});
