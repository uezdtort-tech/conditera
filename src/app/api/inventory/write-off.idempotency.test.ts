/**
 * write-off.idempotency.test.ts — регрессия списания склада (приёмка Z-v12,
 * контракт перенесён на атомарный RPC 0081 в Z-v32/ZV31-002).
 *
 * Лочит контракт POST /api/inventory/write-off (order-путь → ОДИН вызов
 * apply_order_write_off_atomic; миграции 0048/0049/0081):
 *   • повторный запрос того же батча по заказу → сохранённый результат
 *     (idempotent:true) — replay решается ВНУТРИ RPC (реестр-первым),
 *     повторного применения движений нет (сценарий B);
 *   • успешный батч → 201, applied из ответа RPC, единый вызов с сигнатурой;
 *   • нехватка по всем позициям → 409, списания нет (сценарий A);
 *   • частичный успех → 201 с applied+failed (сохранён);
 *   • списание БЕЗ order_id — прежний per-item путь 0048, без дедупликации;
 *   • пустой items / некорректное количество → 400.
 *
 * supabaseAdmin.rpc замокан canned-ответами — реальная БД не затрагивается.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const OWNER = "11111111-1111-4111-8111-111111111101";
const ORDER_ID = "5828a175-c3b0-43e3-a6c2-303881948a38";
const ITEM_A = "609a0d84-5ad4-4c0d-8eff-06ed6d51c616";
const ITEM_B = "817dc734-983d-4b95-8a66-fc13c3b9d2c8";

const rpcState = {
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  data: null as unknown,
  error: null as (Error & { code?: string }) | null,
};

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcState.calls.push({ name, args });
      return { data: rpcState.data, error: rpcState.error };
    },
    from: (table: string) => {
      throw new Error(`order-путь не должен ходить в ${table} напрямую — только RPC 0081`);
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => ({ id: OWNER, roles: ["CONFECTIONER"] })),
}));
vi.mock("@/lib/supabase/auth", () => ({
  unauthorizedResponse: () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
}));
vi.mock("@/lib/ops/order-access", () => ({
  loadOrderLite: vi.fn(async () => ({
    id: ORDER_ID,
    status: "PREPARING",
    confectioner_id: OWNER,
  })),
  canOperateOrder: vi.fn(async () => true),
}));

// Без order_id route идёт прежним per-item путём (0048) — движок мокаем очередью.
type MovementResult =
  | { ok: true; item: { id: string; name: string; quantity: number; unit: string }; movement: { id: string } }
  | { ok: false; error: { kind: "insufficient" | "not_found" | "forbidden" | "unknown"; available?: number } };
let movementQueue: MovementResult[] = [];
let movementCalls: Array<{ item_id: string; type: string; quantity: number }> = [];

vi.mock("@/lib/inventory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inventory")>();
  return {
    ...actual,
    applyInventoryMovement: vi.fn(async (_actor: unknown, m: { item_id: string; type: string; quantity: number }) => {
      movementCalls.push({ item_id: m.item_id, type: m.type, quantity: m.quantity });
      const next = movementQueue.shift();
      if (!next) throw new Error("movementQueue empty — тест не настроил очередь");
      return next;
    }),
  };
});

import { POST as postWriteOff } from "./write-off/route";

const req = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost:3000/api/inventory/write-off", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const appliedA = {
  item_id: ITEM_A,
  item_name: "Мука",
  movement_id: "mv-1",
  quantity: 2,
  remaining: 23,
  unit: "кг",
};

beforeEach(() => {
  rpcState.calls = [];
  rpcState.data = null;
  rpcState.error = null;
  movementQueue = [];
  movementCalls = [];
});

describe("POST /api/inventory/write-off — идемпотентность через RPC 0081 и негативные сценарии", () => {
  it("повторный запрос того же батча → сохранённый результат, replay внутри RPC (сценарий B)", async () => {
    rpcState.data = { idempotent: true, order_id: ORDER_ID, applied: [appliedA], failed: [] };
    const res = await postWriteOff(req({ order_id: ORDER_ID, items: [{ item_id: ITEM_A, quantity: 2 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
    expect(body.duplicate).toBe(true);
    expect(body.applied).toHaveLength(1);
    expect(body.message).toContain("уже было выполнено");
    expect(rpcState.calls).toHaveLength(1); // ровно один вызов, без per-item применения
  });

  it("успешный батч → 201, ОДИН вызов RPC с сигнатурой и обеими позициями", async () => {
    rpcState.data = {
      idempotent: false,
      order_id: ORDER_ID,
      applied: [appliedA, { ...appliedA, item_id: ITEM_B, movement_id: "mv-2", quantity: 0.6, remaining: 4.9 }],
      failed: [],
    };
    const res = await postWriteOff(req({
      order_id: ORDER_ID,
      items: [{ item_id: ITEM_A, quantity: 2 }, { item_id: ITEM_B, quantity: 0.6 }],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.applied).toHaveLength(2);
    expect(body.failed).toHaveLength(0);
    expect(rpcState.calls).toHaveLength(1);
    expect(rpcState.calls[0].args.p_inventory_owner_id).toBe(OWNER);
    expect(rpcState.calls[0].args.p_order_id).toBe(ORDER_ID);
    expect(rpcState.calls[0].args.p_items).toEqual([
      { item_id: ITEM_A, quantity: 2 },
      { item_id: ITEM_B, quantity: 0.6 },
    ]);
    expect(typeof rpcState.calls[0].args.p_signature).toBe("string");
    expect((rpcState.calls[0].args.p_signature as string).length).toBe(64);
  });

  it("нехватка по всем позициям → 409, списания нет (сценарий A)", async () => {
    rpcState.error = Object.assign(
      new Error(
        `[order_write_off] apply_failed:insufficient:[{"item_id":"${ITEM_A}","error":"Недостаточно на складе: доступно 0.5"},{"item_id":"${ITEM_B}","error":"Недостаточно на складе: доступно 1"}]`
      ),
      { code: "P0001" }
    );
    const res = await postWriteOff(req({
      order_id: ORDER_ID,
      items: [{ item_id: ITEM_A, quantity: 2 }, { item_id: ITEM_B, quantity: 0.6 }],
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Недостаточно");
    expect(body.failed).toHaveLength(2);
  });

  it("частичный успех → 201 с applied+failed (семантика сохранена RPC)", async () => {
    rpcState.data = {
      idempotent: false,
      order_id: ORDER_ID,
      applied: [appliedA],
      failed: [{ item_id: ITEM_B, error: "Недостаточно на складе: доступно 0.1" }],
    };
    const res = await postWriteOff(req({
      order_id: ORDER_ID,
      items: [{ item_id: ITEM_A, quantity: 2 }, { item_id: ITEM_B, quantity: 0.6 }],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(body.failed).toHaveLength(1);
  });

  it("нет order_id — прежний per-item путь 0048 без дедупликации, RPC не вызывается", async () => {
    movementQueue = [{ ok: true, item: { id: ITEM_A, name: "Мука", quantity: 23, unit: "кг" }, movement: { id: "mv-1" } }];
    const res = await postWriteOff(req({ items: [{ item_id: ITEM_A, quantity: 2 }] }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(movementCalls).toEqual([{ item_id: ITEM_A, type: "OUT", quantity: 2 }]);
    expect(rpcState.calls).toHaveLength(0);
  });

  it("пустой items → 400 без вызова RPC", async () => {
    const res = await postWriteOff(req({ order_id: ORDER_ID, items: [] }));
    expect(res.status).toBe(400);
    expect(rpcState.calls).toHaveLength(0);
  });

  it("некорректное количество (строка/0) → 400 без вызова RPC", async () => {
    const res = await postWriteOff(req({ order_id: ORDER_ID, items: [{ item_id: ITEM_A, quantity: "abc" }] }));
    expect(res.status).toBe(400);
    expect(rpcState.calls).toHaveLength(0);
  });
});
