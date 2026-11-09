/**
 * RELEASE-03 (задача 2-c): изменения quantity ТОЛЬКО через журнал движений.
 *
 * Покрывает:
 *   1. setQuantityViaMovement(target=7) → RPC "apply_inventory_movement_atomic"
 *      вызван с p_type:"ADJUST", p_quantity:7
 *   2. target=0, current=5 → RPC с p_type:"OUT", p_quantity:5
 *   3. target=0, current=0 → RPC НЕ вызван, ok:true (no-op)
 *   4. extractItemUpdates({name:"x", quantity:999}) → в whitelist-объекте
 *      нет ключа quantity (прямые UPDATE остатка в API запрещены)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted — чтобы моки были доступны внутри vi.mock-фабрик (hoisting)
const db = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: db.from, rpc: db.rpc },
}));

vi.mock("@/lib/n8n", () => ({
  emitEvent: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/lib/ops/events", () => ({
  recordEvent: vi.fn(() => undefined),
}));

// Route-модуль импортируем ради extractItemUpdates; env-зависимые модули мокаем
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => null),
}));

vi.mock("@/lib/supabase/auth", () => ({
  forbiddenResponse: vi.fn(() => new Response(null, { status: 403 })),
  unauthorizedResponse: vi.fn(() => new Response(null, { status: 401 })),
}));

import {
  setQuantityViaMovement,
  type InventoryActor,
  type InventoryItemRow,
  type InventoryMovementRow,
} from "@/lib/inventory";
import { extractItemUpdates } from "@/app/api/inventory/items/route";

const ACTOR: InventoryActor = { id: "user-1", roles: ["CONFECTIONER"] };

function itemRow(overrides: Partial<InventoryItemRow> = {}): InventoryItemRow {
  return {
    id: "item-1",
    owner_id: ACTOR.id,
    name: "Мука",
    category: null,
    quantity: 0,
    unit: "kg",
    min_quantity: 0,
    cost_per_unit: 100,
    supplier: null,
    is_active: true,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function movementRow(overrides: Partial<InventoryMovementRow> = {}): InventoryMovementRow {
  return {
    id: "mov-1",
    item_id: "item-1",
    user_id: ACTOR.id,
    type: "ADJUST",
    quantity: 0,
    reason: null,
    order_id: null,
    created_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface Load {
  data: unknown;
  error?: { message: string } | null;
}

/**
 * Мок query-builder: каждый вызов from() забирает следующий результат из
 * очереди (select("quantity") → select("*") → ...), методы цепочки — no-op.
 */
function mockDbLoads(loads: Load[]) {
  let i = 0;
  db.from.mockImplementation(() => {
    const res = loads[Math.min(i, loads.length - 1)] ?? { data: null, error: null };
    i += 1;
    const qb: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "update", "insert", "delete"] as const) {
      qb[method] = vi.fn(() => qb);
    }
    qb.maybeSingle = vi.fn(() => Promise.resolve(res));
    qb.single = vi.fn(() => Promise.resolve(res));
    return qb;
  });
}

function mockRpc(
  result: {
    ok: boolean;
    code?: string;
    available?: number | string | null;
    new_qty?: number | string | null;
    movement?: InventoryMovementRow | null;
    item?: InventoryItemRow | null;
  } | null
) {
  db.rpc.mockImplementation(() => ({
    single: () => Promise.resolve({ data: result, error: null }),
  }));
}

beforeEach(() => {
  db.from.mockReset();
  db.rpc.mockReset();
});

describe("setQuantityViaMovement (RELEASE-02 §9)", () => {
  it("target=7 → rpc ADJUST c p_quantity=7", async () => {
    mockDbLoads([{ data: { quantity: 3 } }, { data: itemRow({ quantity: 3 }) }]);
    mockRpc({
      ok: true,
      code: "ok",
      available: null,
      new_qty: 7,
      movement: movementRow({ type: "ADJUST", quantity: 7 }),
      item: itemRow({ quantity: 7 }),
    });

    const res = await setQuantityViaMovement(ACTOR, "item-1", 7, "тест ADJUST");

    expect(res.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith(
      "apply_inventory_movement_atomic",
      expect.objectContaining({ p_item_id: "item-1", p_type: "ADJUST", p_quantity: 7 })
    );
  });

  it("target=0, current=5 → rpc OUT c p_quantity=5", async () => {
    mockDbLoads([{ data: { quantity: 5 } }, { data: itemRow({ quantity: 5 }) }]);
    mockRpc({
      ok: true,
      code: "ok",
      available: null,
      new_qty: 0,
      movement: movementRow({ type: "OUT", quantity: 5 }),
      item: itemRow({ quantity: 0 }),
    });

    const res = await setQuantityViaMovement(ACTOR, "item-1", 0, "тест OUT");

    expect(res.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith(
      "apply_inventory_movement_atomic",
      expect.objectContaining({ p_item_id: "item-1", p_type: "OUT", p_quantity: 5 })
    );
  });

  it("target=0, current=0 → rpc НЕ вызван, ok:true (no-op)", async () => {
    mockDbLoads([{ data: { quantity: 0 } }, { data: itemRow({ quantity: 0 }) }]);

    const res = await setQuantityViaMovement(ACTOR, "item-1", 0, "no-op тест");

    expect(res.ok).toBe(true);
    expect(db.rpc).not.toHaveBeenCalled();
    if (res.ok) {
      expect(res.movement.quantity).toBe(0);
      expect(res.movement.reason).toContain("no-op");
    }
  });
});

describe("extractItemUpdates (whitelist PATCH без quantity)", () => {
  it("quantity не входит в whitelist-объект", () => {
    const updates = extractItemUpdates({ name: "x", quantity: 999 });
    expect(updates.name).toBe("x");
    expect(updates).not.toHaveProperty("quantity");
    expect(Object.keys(updates)).not.toContain("quantity");
  });

  it("id/owner_id также исключены из whitelist", () => {
    const updates = extractItemUpdates({
      id: "hack",
      owner_id: "hack",
      name: "y",
      is_active: false,
    });
    expect(updates).not.toHaveProperty("id");
    expect(updates).not.toHaveProperty("owner_id");
    expect(updates.name).toBe("y");
    expect(updates.is_active).toBe(false);
  });
});
