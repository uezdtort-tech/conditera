/**
 * Этап 10 §A2: PATCH /api/orders/[id] обязан писать order_status_history
 * (аудит-паритет с движком lifecycle P0.5, который историю писал, а PATCH — нет).
 *
 * Проверяются: успешный переход пишет историю (status_from/to, changed_by,
 * comment); ошибка журнала НЕ роняет уже выполненный переход (status —
 * источник истины); запрещённый переход историю не пишет.
 *
 * Z-v14 (CAS + идемпотентность уведомления):
 *   • UPDATE каскадно защищён по статусу (.eq("status", order.status)) —
 *     проигравший гонку получает 409 БЕЗ записи истории и БЕЗ уведомления;
 *   • ORDER_CONFIRMED создаётся только после успешного перехода и несёт
 *     dedupKey order-confirmed:<orderId> (UNIQUE-индекс 0060);
 *   • ошибка отправки уведомления не превращает успешный переход в ошибку API.
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
// Результат CAS-обновления: по умолчанию строка обновлена (массив из 1);
// тесты гонки подменяют на [] — CAS не совпал.
let casResult: { data: Array<Record<string, unknown>> | null; error: { message: string } | null } = {
  data: null,
  error: null,
};

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
          // Z-v14 CAS-цепочка: update().eq("id",...).eq("status",...).select() → массив.
          // Если casResult задан тестом явно (гонка/ошибка БД) — вернуть как есть;
          // иначе динамически слить payload с исходной строкой (статус применился).
          update: (payload: Record<string, unknown>) => {
            updateCalls.push(payload);
            return {
              eq: () => ({
                eq: () => ({
                  select: () =>
                    Promise.resolve(
                      casResult.data !== null || casResult.error !== null
                        ? casResult
                        : { data: [{ ...orderRow, ...payload }], error: null }
                    ),
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

const sendNotification = vi.fn().mockResolvedValue({ notificationIds: ["n1"] });
vi.mock("@/lib/notifications", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
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
  casResult = { data: null, error: null }; // null/null = динамический мок (payload применяется)
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

describe("Z-v14: CAS по статусу и идемпотентность ORDER_CONFIRMED", () => {
  it("успешный переход CONFIRMED отправляет уведомление с dedupKey order-confirmed:<id>", async () => {
    const res = await callPatch("CONFIRMED");
    expect(res.status).toBe(200);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const arg = sendNotification.mock.calls[0][0] as {
      template: string;
      userId: string;
      dedupKey: string;
    };
    expect(arg.template).toBe("ORDER_CONFIRMED");
    expect(arg.userId).toBe("customer-uuid");
    expect(arg.dedupKey).toBe(`order-confirmed:${orderRow.id}`);
  });

  it("не-CONFIRMED переход уведомление не отправляет", async () => {
    const res = await callPatch("CANCELLED", "Отклонён");
    expect(res.status).toBe(200);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("ошибка отправки уведомления НЕ превращает успешный переход в ошибку API", async () => {
    sendNotification.mockRejectedValueOnce(new Error("smtp down"));
    const res = await callPatch("CONFIRMED");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: { status: string } };
    expect(body.order.status).toBe("CONFIRMED");
    expect(historyInserts).toHaveLength(1);
  });

  it("проигравший CAS-гонку получает 409: без истории и без уведомления", async () => {
    // Параллельный запрос уже сменил статус → CAS-UPDATE вернул 0 строк
    casResult = { data: [], error: null };
    const res = await callPatch("CONFIRMED");
    expect(res.status).toBe(409);
    expect(historyInserts).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("ошибка БД при CAS-обновлении — 500, без истории и уведомления", async () => {
    casResult = { data: null, error: { message: "db down" } };
    const res = await callPatch("CONFIRMED");
    expect(res.status).toBe(500);
    expect(historyInserts).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("повторный PATCH уже подтверждённого заказа (CONFIRMED→CONFIRMED) — 400, без уведомления", async () => {
    orderRow.status = "CONFIRMED"; // чтение возвращает уже подтверждённый заказ
    const res = await callPatch("CONFIRMED");
    expect(res.status).toBe(400); // переход отсутствует в матрице
    expect(updateCalls).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
