/**
 * Этап 10 §A2: PATCH /api/orders/[id] обязан писать order_status_history
 * (аудит-паритет с движком lifecycle P0.5, который историю писал, а PATCH — нет).
 *
 * Проверяются: успешный переход пишет историю (status_from/to, changed_by,
 * comment); ошибка журнала НЕ роняет уже выполненный переход (status —
 * источник истины); запрещённый переход историю не пишет.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// --- Гибкий мок supabaseAdmin.from(table) ---

const orderRow = {
  id: "ord-1111-2222-3333",
  number: "UK-2026-000042",
  user_id: "customer-uuid",
  confectioner_id: "confectioner-uuid",
  status: "PENDING",
};

const updateCalls: Array<Record<string, unknown>> = [];
const historyInserts: Array<Record<string, unknown>> = [];
let historyInsertError: { message: string } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === "orders") {
        const b = {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { ...orderRow }, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updateCalls.push(payload);
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { ...orderRow, ...(payload as { status: string }) },
                      error: null,
                    }),
                }),
              }),
            };
          },
        };
        return b;
      }
      if (table === "order_status_history") {
        return {
          insert: (payload: Record<string, unknown>) => {
            historyInserts.push(payload);
            return Promise.resolve({ error: historyInsertError });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));

const getUserFromRequest = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequest(...args),
}));

vi.mock("@/lib/supabase/auth", () => ({
  forbiddenResponse: (message: string) =>
    NextResponse.json({ error: message }, { status: 403 }),
  unauthorizedResponse: () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/courier-assignments", () => ({
  isCourierAssignedToOrder: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/n8n", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ops/events", () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "./route";

const USER = { id: "confectioner-uuid", userId: "confectioner-uuid", roles: ["CONFECTIONER"] };

async function callPatch(status: string, comment?: string): Promise<NextResponse> {
  const request = new NextRequest(`http://localhost:3000/api/orders/${orderRow.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, comment }),
  });
  return PATCH(request, { params: Promise.resolve({ id: orderRow.id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  historyInserts.length = 0;
  historyInsertError = null;
  orderRow.status = "PENDING";
  getUserFromRequest.mockResolvedValue(USER);
});

describe("PATCH /api/orders/[id] — аудит order_status_history (Этап 10 §A2)", () => {
  it("успешный переход кондитера пишет запись истории", async () => {
    const res = await callPatch("CONFIRMED");
    expect(res.status).toBe(200);
    expect(updateCalls[0]?.status).toBe("CONFIRMED");
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]).toMatchObject({
      order_id: orderRow.id,
      status_from: "PENDING",
      status_to: "CONFIRMED",
      changed_by: USER.id,
      comment: null,
    });
  });

  it("comment попадает в историю (отклонение кондитером)", async () => {
    const res = await callPatch("CANCELLED", "Отклонён кондитером");
    expect(res.status).toBe(200);
    expect(historyInserts[0]).toMatchObject({
      status_from: "PENDING",
      status_to: "CANCELLED",
      changed_by: USER.id,
      comment: "Отклонён кондитером",
    });
  });

  it("ошибка вставки истории не роняет выполненный переход", async () => {
    historyInsertError = { message: "insert failed" };
    const res = await callPatch("CONFIRMED");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: { status: string } };
    expect(body.order.status).toBe("CONFIRMED");
  });

  it("запрещённый переход историю не пишет", async () => {
    const res = await callPatch("COMPLETED"); // PENDING → COMPLETED запрещён
    expect(res.status).toBe(400);
    expect(historyInserts).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});
