/**
 * P1 (courier) + A-2: синхронизация deliveries при PATCH → DELIVERED.
 *
 * Первопричина (22eff00): courier/assign ставил orders.status=IN_DELIVERY,
 * но deliveries.status навсегда оставался 'assigned'.
 *
 * A-2 (регресс молчаливого пропуска синхронизации): sync-чтение шло через
 * .maybeSingle() без деструктуризации error — при двух активных доставках
 * одного заказа PostgREST возвращал ошибку «multiple rows», data=null, sync
 * молча пропускался без записи в лог. Теперь:
 *   • инвариант «≤ 1 активной доставки» проверяется ДО обновления заказа
 *     (>1 → 409, заказ не трогается — нет частично завершённого процесса);
 *   • ошибка чтения → fail-closed 500 до обновления;
 *   • sync-запись: ошибка честно отражается в ответе (deliverySync:"failed"),
 *     не роняя уже выполненный переход (статус заказа = источник истины);
 *   • гейт назначения курьера — массив-запрос .limit(1) вместо .maybeSingle()
 *     (дубль строки order+courier больше не даёт ложный 403; ошибка БД — 500).
 *
 * Проверяются: (1) успешный sync (courier_earnings=cost, CAS по активным
 * статусам, deliverySync:"ok"); (2) 0 активных доставок → переход без sync;
 * (3) 2 активные доставки → 409 БЕЗ обновления заказа; (4) ошибка чтения
 * доставок → 500 БЕЗ обновления заказа; (5) ошибка sync-записи → 200 +
 * deliverySync:"failed"; (6) гейт: назначен/не назначен/ошибка БД/дубль строки;
 * (7) повторный запрос после ошибки БД восстанавливается.
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

type DeliveryRow = { id: string; status: string; cost: number | null };

let gateResult: { data: { id: string }[] | null; error: { message: string } | null } = {
  data: [{ id: "del-0001" }],
  error: null,
};
let activeDeliveriesResult: { data: DeliveryRow[] | null; error: { message: string } | null } = {
  data: [{ id: "del-0001", status: "picked_up", cost: 350 }],
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
          // Z-v14: CAS-цепочка update().eq("id",...).eq("status",...).select() → массив
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () =>
                  Promise.resolve({
                    data: [{ ...orderRow, status: "DELIVERED" }],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "deliveries") {
        // Цепочки маршрута (A-2):
        //   (1) гейт назначения: select().eq().eq().limit(1) → массив;
        //   (2) pre-flight инварианта: select().eq().in(...) → thenable-терминал;
        //   (3) sync-запись: update().eq().in(...) → { error }.
        const b = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(() => Promise.resolve(activeDeliveriesResult)),
          limit: vi.fn(() => Promise.resolve(gateResult)),
        };
        return {
          select: vi.fn(() => b),
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
const ADMIN = { id: "admin-uuid", userId: "admin-uuid", roles: ["ADMIN"] };

async function callPatch(status = "DELIVERED"): Promise<NextResponse> {
  const request = new NextRequest(`http://localhost:3000/api/orders/${orderRow.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return PATCH(request, { params: Promise.resolve({ id: orderRow.id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  deliveryUpdateCalls.length = 0;
  historyInserts.length = 0;
  gateResult = { data: [{ id: "del-0001" }], error: null };
  activeDeliveriesResult = {
    data: [{ id: "del-0001", status: "picked_up", cost: 350 }],
    error: null,
  };
  deliveryUpdateError = null;
  orderRow.status = "IN_DELIVERY";
  getUserFromRequest.mockResolvedValue(COURIER);
});

describe("PATCH /api/orders/[id] — DELIVERED-sync и инвариант доставок (A-2)", () => {
  it("успешный переход курьера DELIVERED синхронизирует deliveries (CAS, deliverySync:'ok')", async () => {
    const res = await callPatch();
    expect(res.status).toBe(200);

    const json = (await res.json()) as { deliverySync?: string };
    expect(json.deliverySync).toBe("ok");

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
      courier_earnings: 350, // = cost (снимок на момент доставки)
    });
    expect(typeof deliveryUpdateCalls[0]?.delivered_at).toBe("string");
    expect(typeof deliveryUpdateCalls[0]?.updated_at).toBe("string");
  });

  it("0 активных доставок (самовывоз) → переход без sync, deliverySync:'skipped_no_delivery'", async () => {
    activeDeliveriesResult = { data: [], error: null };
    const res = await callPatch();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { deliverySync?: string };
    expect(json.deliverySync).toBe("skipped_no_delivery");
    expect(deliveryUpdateCalls).toHaveLength(0);
    expect(historyInserts).toHaveLength(1);
  });

  it("2 активные доставки → 409 ДО обновления заказа (нет частично завершённого процесса)", async () => {
    activeDeliveriesResult = {
      data: [
        { id: "del-0001", status: "picked_up", cost: 350 },
        { id: "del-0002", status: "assigned", cost: 350 },
      ],
      error: null,
    };
    const res = await callPatch();
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("активных доставок");
    // заказ НЕ обновлён, история НЕ записана — аномалия поймана до точки невозврата
    expect(historyInserts).toHaveLength(0);
  });

  it("ошибка БД при чтении активных доставок → fail-closed 500 ДО обновления заказа", async () => {
    activeDeliveriesResult = { data: null, error: { message: "multiple rows returned" } };
    const res = await callPatch();
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("доставк");
    expect(historyInserts).toHaveLength(0);
  });

  it("повторный запрос после ошибки БД читает deliveries заново (восстановление)", async () => {
    activeDeliveriesResult = { data: null, error: { message: "timeout" } };
    const first = await callPatch();
    expect(first.status).toBe(500);

    activeDeliveriesResult = {
      data: [{ id: "del-0001", status: "picked_up", cost: 350 }],
      error: null,
    };
    const second = await callPatch();
    expect(second.status).toBe(200);
    const json = (await second.json()) as { deliverySync?: string };
    expect(json.deliverySync).toBe("ok");
  });

  it("ошибка sync-записи не роняет переход: 200 + честный deliverySync:'failed'", async () => {
    deliveryUpdateError = { message: "update failed" };
    const res = await callPatch();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { order?: { status?: string }; deliverySync?: string };
    expect(json.order?.status).toBe("DELIVERED");
    expect(json.deliverySync).toBe("failed");
    // история всё равно записана, попытка синхронизации была
    expect(historyInserts).toHaveLength(1);
    expect(deliveryUpdateCalls).toHaveLength(1);
  });

  it("неназначенный курьер → 403 (гейт по deliveries, массив-запрос)", async () => {
    gateResult = { data: [], error: null };
    const res = await callPatch();
    expect(res.status).toBe(403);
    expect(historyInserts).toHaveLength(0);
  });

  it("ошибка БД в гейте назначения → fail-closed 500 (не ложный 403)", async () => {
    gateResult = { data: null, error: { message: "connection refused" } };
    const res = await callPatch();
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("назначение");
    expect(historyInserts).toHaveLength(0);
  });

  it("регресс A-2: дубль строки (order+courier) в deliveries не даёт ложный 403 легитимному курьеру", async () => {
    // .maybeSingle() на дубле возвращал ошибку → assignment=null → 403.
    // Массив-запрос .limit(1) возвращает первую строку → гейт пройден.
    gateResult = { data: [{ id: "del-0001" }, { id: "del-0009" }], error: null };
    const res = await callPatch();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { deliverySync?: string };
    expect(json.deliverySync).toBe("ok");
  });

  it("ADMIN-переход без строки deliveries не падает (sync пропущен)", async () => {
    getUserFromRequest.mockResolvedValue(ADMIN);
    gateResult = { data: [], error: null };
    activeDeliveriesResult = { data: [], error: null };
    const res = await callPatch();
    expect(res.status).toBe(200);
    expect(deliveryUpdateCalls).toHaveLength(0);
    expect(historyInserts[0]).toMatchObject({ status_to: "DELIVERED" });
  });
});
