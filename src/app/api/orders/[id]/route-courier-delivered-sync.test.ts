/**
 * P1 (courier): синхронизация deliveries при PATCH → DELIVERED.
 *
 * Первопричина (22eff00): courier/assign ставил orders.status=IN_DELIVERY,
 * но deliveries.status навсегда оставался 'assigned' — кабинет курьера
 * (фильтр deliveries.status='delivered') и API показывали разные цифры,
 * у доставки не заполнялись delivered_at/courier_earnings.
 *
 * Проверяются: (1) успешный переход курьера DELIVERED синхронизирует строку
 * deliveries (status=delivered, delivered_at, courier_earnings=cost) с CAS по
 * активным статусам; (2) сбой синхронизации НЕ роняет уже выполненный переход
 * (fail-safe, статус заказа = источник истины); (3) у заказа без строки
 * deliveries синхронизация не падает.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// --- Гибкий мок supabaseAdmin.from(table) ---

const orderRow = {
  id: "ord-1111-2222-3333",
  number: "UK-2026-000042",
  user_id: "customer-uuid",
  confectioner_id: "confectioner-uuid",
  status: "IN_DELIVERY",
};

const deliveryRow = {
  id: "del-0001",
  order_id: orderRow.id,
  courier_id: "courier-uuid",
  status: "picked_up",
  cost: 350,
};

let deliverySelectResult: { data: typeof deliveryRow | null; error: unknown } = {
  data: { ...deliveryRow },
  error: null,
};
let deliveryUpdateError: { message: string } | null = null;

const deliveryUpdateCalls: Array<Record<string, unknown>> = [];
const historyInserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { ...orderRow }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { ...orderRow, status: "DELIVERED" },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "deliveries") {
        // Цепочки маршрута: (1) assignment-проверка select().eq(order).eq(courier).maybeSingle();
        // (2) sync-чтение select().eq(order).in(status).maybeSingle();
        // (3) sync-запись update().eq(id).in(status). Развязка: .eq копит фильтры,
        // терминалы (maybeSingle) развивают по наличию in-фильтра.
        const b: {
          eq: ReturnType<typeof vi.fn>;
          in: ReturnType<typeof vi.fn>;
          maybeSingle: () => Promise<unknown>;
        } = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          maybeSingle: () =>
            Promise.resolve(deliverySelectResult),
        };
        // sync-чтение идёт через .in().maybeSingle — тот же builder.
        return {
          select: () => b,
          update: (payload: Record<string, unknown>) => {
            deliveryUpdateCalls.push(payload);
            return {
              eq: () => ({
                in: () => Promise.resolve({ error: deliveryUpdateError }),
              }),
            };
          },
        };
      }
      if (table === "order_status_history") {
        return {
          insert: (payload: Record<string, unknown>) => {
            historyInserts.push(payload);
            return Promise.resolve({ error: null });
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

vi.mock("@/lib/n8n", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ops/events", () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "./route";

const COURIER = { id: "courier-uuid", userId: "courier-uuid", roles: ["CUSTOMER", "COURIER"] };

async function callPatch(): Promise<NextResponse> {
  const request = new NextRequest(`http://localhost:3000/api/orders/${orderRow.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "DELIVERED" }),
  });
  return PATCH(request, { params: Promise.resolve({ id: orderRow.id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  deliveryUpdateCalls.length = 0;
  historyInserts.length = 0;
  deliveryUpdateError = null;
  deliverySelectResult = { data: { ...deliveryRow }, error: null };
  orderRow.status = "IN_DELIVERY";
  getUserFromRequest.mockResolvedValue(COURIER);
});

describe("PATCH /api/orders/[id] — синхронизация deliveries при DELIVERED (P1 courier)", () => {
  it("успешный переход курьера DELIVERED синхронизирует deliveries (CAS по активным статусам)", async () => {
    const res = await callPatch();
    expect(res.status).toBe(200);

    // история перехода записана
    expect(historyInserts[0]).toMatchObject({
      status_from: "IN_DELIVERY",
      status_to: "DELIVERED",
      changed_by: "courier-uuid",
    });

    // строка доставки синхронизирована
    expect(deliveryUpdateCalls).toHaveLength(1);
    expect(deliveryUpdateCalls[0]).toMatchObject({
      status: "delivered",
      courier_earnings: 350, // = cost
    });
    expect(typeof deliveryUpdateCalls[0]?.delivered_at).toBe("string");
    expect(typeof deliveryUpdateCalls[0]?.updated_at).toBe("string");
  });

  it("сбой синхронизации deliveries не роняет переход (fail-safe: статус = источник истины)", async () => {
    deliveryUpdateError = { message: "update failed" };
    const res = await callPatch();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { order?: { status?: string } };
    expect(json.order?.status).toBe("DELIVERED");
    // история всё равно записана, попытка синхронизации была
    expect(historyInserts).toHaveLength(1);
    expect(deliveryUpdateCalls).toHaveLength(1);
  });

  it("заказ без активной строки deliveries не падает (переход ADMIN выполняется)", async () => {
    // Курьер без строки deliveries был бы 403 на assignment-проверке
    // (корректное поведение) — путь «переход без deliveries» достижим
    // для ADMIN: sync-чтение даёт null, переход не падает.
    getUserFromRequest.mockResolvedValue({
      id: "admin-uuid",
      userId: "admin-uuid",
      roles: ["ADMIN"],
    });
    deliverySelectResult = { data: null, error: null };
    const res = await callPatch();
    expect(res.status).toBe(200);
    expect(deliveryUpdateCalls).toHaveLength(0);
    expect(historyInserts[0]).toMatchObject({ status_to: "DELIVERED" });
  });
});
