/**
 * write-off.idempotency.test.ts — регрессия списания склада (приёмка Z-v12).
 *
 * Лочит контракт POST /api/inventory/write-off (миграции 0048/0049 НЕ трогаем):
 *   • повторный запрос того же батча по заказу → сохранённый результат
 *     (idempotent:true), applyInventoryMovement НЕ вызывается повторно
 *     (сценарий B: нет двойного списания);
 *   • успешный батч → 201, движений по каждому item'у, вставка в реестр
 *     inventory_write_offs с сигнатурой;
 *   • нехватка по всем позициям → 409 (недостаточно на складе), без вставки
 *     в реестр (сценарий A: списание не выполнено);
 *   • частичный успех → 201 с applied+failed, реестр фиксирует оба списка;
 *   • параллельная вставка (23505) → возвращает результат победителя
 *     (idempotent:true) (сценарий C);
 *   • пустое сообщение/пустой items → 400.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const OWNER = "11111111-1111-4111-8111-111111111101";
const ORDER_ID = "5828a175-c3b0-43e3-a6c2-303881948a38";
const ITEM_A = "609a0d84-5ad4-4c0d-8eff-06ed6d51c616";
const ITEM_B = "817dc734-983d-4b95-8a66-fc13c3b9d2c8";

const dbState = {
  registry: null as Record<string, unknown> | null,
  registryInserts: [] as Array<Record<string, unknown>>,
  insertError: null as { code?: string } | null,
};

function resetDb() {
  dbState.registry = null;
  dbState.registryInserts = [];
  dbState.insertError = null;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const api: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const rec = (op: string) => (...args: unknown[]) => {
        if (op === "eq") filters.push([args[0] as string, args[1]]);
        if (op === "insert") {
          if (table === "inventory_write_offs") {
            dbState.registryInserts.push(args[0] as Record<string, unknown>);
          }
        }
        return api;
      };
      Object.assign(api, {
        select: rec("select"),
        insert: rec("insert"),
        update: rec("update"),
        eq: rec("eq"),
        maybeSingle: () =>
          Promise.resolve({ data: dbState.registry, error: null }),
        then: (
          onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
          onRejected?: (e: unknown) => unknown
        ) =>
          Promise.resolve({ data: null, error: dbState.insertError }).then(onFulfilled, onRejected),
        catch: (onRejected: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: dbState.insertError }).catch(onRejected),
      });
      return api;
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => ({ id: OWNER, roles: ["CONFECTIONER"] })),
}));
vi.mock("@/lib/supabase/auth", () => ({
  unauthorizedResponse: () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
}));

// Очередь результатов движка: route вызывает applyInventoryMovement на каждый item.
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

const okResult = (id: string, remaining: number): MovementResult => ({
  ok: true,
  item: { id, name: `item-${id.slice(0, 6)}`, quantity: remaining, unit: "кг" },
  movement: { id: `mv-${id.slice(0, 6)}` },
});
const insufficient = (available: number): MovementResult => ({
  ok: false,
  error: { kind: "insufficient", available },
});

beforeEach(() => {
  resetDb();
  movementQueue = [];
  movementCalls = [];
});

describe("POST /api/inventory/write-off — идемпотентность и негативные сценарии", () => {
  it("повторный запрос того же батча → сохранённый результат, движок НЕ вызывается (сценарий B)", async () => {
    dbState.registry = {
      id: "reg-1",
      items: [{ item_id: ITEM_A, quantity: 2 }],
      result: { applied: [{ item_id: ITEM_A, item_name: "Мука", movement_id: "mv-1", quantity: 2, remaining: 23, unit: "кг" }], failed: [] },
      created_at: new Date().toISOString(),
    };
    const res = await postWriteOff(req({ order_id: ORDER_ID, items: [{ item_id: ITEM_A, quantity: 2 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
    expect(body.duplicate).toBe(true);
    expect(body.applied).toHaveLength(1);
    expect(body.message).toContain("уже было выполнено");
    expect(movementCalls).toHaveLength(0);
    expect(dbState.registryInserts).toHaveLength(0);
  });

  it("успешный батч → 201, движения по каждой позиции, вставка в реестр", async () => {
    movementQueue = [okResult(ITEM_A, 23), okResult(ITEM_B, 4.9)];
    const res = await postWriteOff(req({
      order_id: ORDER_ID,
      items: [{ item_id: ITEM_A, quantity: 2 }, { item_id: ITEM_B, quantity: 0.6 }],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.applied).toHaveLength(2);
    expect(body.failed).toHaveLength(0);
    expect(movementCalls).toEqual([
      { item_id: ITEM_A, type: "OUT", quantity: 2 },
      { item_id: ITEM_B, type: "OUT", quantity: 0.6 },
    ]);
    expect(dbState.registryInserts).toHaveLength(1);
    expect(dbState.registryInserts[0]).toMatchObject({ owner_id: OWNER, order_id: ORDER_ID });
    expect(dbState.registryInserts[0].signature).toBeTruthy();
  });

  it("нехватка по всем позициям → 409, списания нет, реестр не пишется (сценарий A)", async () => {
    movementQueue = [insufficient(0.5), insufficient(1)];
    const res = await postWriteOff(req({
      order_id: ORDER_ID,
      items: [{ item_id: ITEM_A, quantity: 2 }, { item_id: ITEM_B, quantity: 0.6 }],
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Недостаточно");
    expect(body.failed).toHaveLength(2);
    expect(dbState.registryInserts).toHaveLength(0);
  });

  it("частичный успех → 201 с applied+failed, реестр фиксирует оба списка", async () => {
    movementQueue = [okResult(ITEM_A, 23), insufficient(0.1)];
    const res = await postWriteOff(req({
      order_id: ORDER_ID,
      items: [{ item_id: ITEM_A, quantity: 2 }, { item_id: ITEM_B, quantity: 0.6 }],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(body.failed).toHaveLength(1);
    expect(dbState.registryInserts).toHaveLength(1);
  });

  it("параллельная вставка (23505) → результат победителя, idempotent:true (сценарий C)", async () => {
    movementQueue = [okResult(ITEM_A, 23)];
    dbState.insertError = { code: "23505" };
    // «Победитель» уже записал результат — эмулируем его наличием в реестре
    dbState.registry = {
      id: "reg-race",
      items: [{ item_id: ITEM_A, quantity: 2 }],
      result: { applied: [{ item_id: ITEM_A, item_name: "Мука", movement_id: "mv-winner", quantity: 2, remaining: 23, unit: "кг" }], failed: [] },
      created_at: new Date().toISOString(),
    };
    const res = await postWriteOff(req({ order_id: ORDER_ID, items: [{ item_id: ITEM_A, quantity: 2 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
    expect(body.applied[0].movement_id).toBe("mv-winner");
  });

  it("нет order_id — списание без дедупликации (старое поведение), реестр не пишется", async () => {
    movementQueue = [okResult(ITEM_A, 23)];
    const res = await postWriteOff(req({ items: [{ item_id: ITEM_A, quantity: 2 }] }));
    expect(res.status).toBe(201);
    expect(dbState.registryInserts).toHaveLength(0);
  });

  it("пустой items → 400", async () => {
    const res = await postWriteOff(req({ order_id: ORDER_ID, items: [] }));
    expect(res.status).toBe(400);
  });
});
