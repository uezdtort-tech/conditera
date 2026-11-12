/**
 * Тесты D2 (PR-6A2): POST /api/confectioner/products/[id]/price —
 * same-instant установка цены → честный 409 PRICE_PERIOD_CONFLICT вместо 500.
 *
 * Контракт:
 *   • функция 0086 возвращает {noChange:true, sameInstant:true, message} когда
 *     p_effective_from == effective_from покрывающей строки и сумма различается
 *     → маршрут отвечает 409 с сообщением функции (не 200, не 500);
 *   • defense-in-depth: SQLSTATE 23514 на constraint *range_check* (нулевая
 *     ширина) → 409 PRICE_PERIOD_CONFLICT;
 *   • 23P01 → 409 (существующее поведение сохранено);
 *   • P0001 валидации функции → по-прежнему 400 PRICE_VALIDATION_FAILED.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "b0000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "a0000000-0000-4000-8000-000000000001";

const { state, poolQueryMock, userMock, adminMock } = vi.hoisted(() => ({
  state: {
    setRows: [] as unknown[],
    setErr: null as (Error & { code?: string; constraint?: string }) | null,
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

function poolRouter(sql: string): { rows: unknown[] } {
  const q = sql.trim();
  if (/FROM public\.products WHERE id = \$1 AND deleted_at IS NULL/.test(q)) {
    return { rows: [{ id: PRODUCT_ID, confectioner_id: USER_ID }] };
  }
  if (/FROM public\.products WHERE id = \$1\s*$/.test(q)) {
    return { rows: [{ recipe_id: null }] }; // cost snapshot: нет рецепта → null
  }
  if (/set_product_price/.test(q)) {
    if (state.setErr) throw state.setErr;
    return { rows: state.setRows.map((result) => ({ result })) };
  }
  return { rows: [] };
}

import { POST } from "./route";

async function callPost(body: unknown): Promise<Response> {
  const request = new NextRequest(`http://localhost:3000/api/confectioner/products/${PRODUCT_ID}/price`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(request, { params: Promise.resolve({ id: PRODUCT_ID }) });
}

beforeEach(() => {
  poolQueryMock.mockReset();
  poolQueryMock.mockImplementation((sql: string) => poolRouter(sql));
  userMock.mockReset();
  userMock.mockResolvedValue({ id: USER_ID });
  adminMock.mockReset();
  adminMock.mockResolvedValue(false);
  state.setRows = [];
  state.setErr = null;
});

describe("POST price — D2 same-instant → 409 PRICE_PERIOD_CONFLICT", () => {
  it("sameInstant от функции 0086 → 409, сообщение функции наружу", async () => {
    const fnMessage =
      "Изменение цены в тот же момент времени уже зафиксировано — используйте более позднее время или администраторскую коррекцию";
    state.setRows = [
      {
        noChange: true,
        sameInstant: true,
        versionId: PRODUCT_ID,
        previousAmount: 1000,
        newAmount: 1200,
        message: fnMessage,
      },
    ];
    const res = await callPost({ amount: 1200, effectiveFrom: new Date().toISOString(), reason: "ingredients" });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("PRICE_PERIOD_CONFLICT");
    expect(json.message).toBe(fnMessage);
  });

  it("23514 range_check (нулевая ширина) → 409 вместо 500", async () => {
    state.setErr = Object.assign(
      new Error(
        'new row for relation "product_price_history" violates check constraint "product_price_history_range_check"'
      ),
      { code: "23514", constraint: "product_price_history_range_check" }
    );
    const res = await callPost({ amount: 1200, effectiveFrom: new Date().toISOString(), reason: "other" });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("PRICE_PERIOD_CONFLICT");
  });

  it("23514 на ДРУГОМ constraint → не маскируется (500 как прежде)", async () => {
    state.setErr = Object.assign(new Error('violates check constraint "product_price_history_amount_check"'), {
      code: "23514",
      constraint: "product_price_history_amount_check",
    });
    const res = await callPost({ amount: 1200, effectiveFrom: new Date().toISOString(), reason: "other" });
    expect(res.status).toBe(500);
  });

  it("23P01 → 409 (сохранено)", async () => {
    state.setErr = Object.assign(new Error("conflicting key value violates exclusion constraint"), {
      code: "23P01",
    });
    const res = await callPost({ amount: 1200, effectiveFrom: new Date().toISOString(), reason: "other" });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("PRICE_PERIOD_CONFLICT");
  });

  it("P0001 (валидация функции) → 400 PRICE_VALIDATION_FAILED (сохранено)", async () => {
    state.setErr = Object.assign(new Error("invalid reason: bogus"), { code: "P0001" });
    const res = await callPost({ amount: 1200, effectiveFrom: new Date().toISOString(), reason: "other" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("PRICE_VALIDATION_FAILED");
  });

  it("успешная установка (без sameInstant) → 200 как прежде", async () => {
    state.setRows = [
      { versionId: "e0000000-0000-4000-8000-000000000009", previousAmount: 1000, newAmount: 1200, planned: false },
    ];
    const res = await callPost({ amount: 1200, effectiveFrom: new Date().toISOString(), reason: "ingredients" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deltaRub).toBe(200);
    expect(json.error).toBeUndefined();
  });
});
