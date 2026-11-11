/**
 * write-off.snapshot-validation.test.ts — валидация order-списания против
 * snapshot потребности заказа (Z-v30, Этап 5).
 *
 * Лочит (ТЗ Z-v30 §6):
 *   • списание по заказу со snapshot валидируется против норматива snapshot
 *     (норма × количество, конвертация в единицу склада той же convertQty,
 *     что и breakdown); ТЕСТОВЫЕ ЧИСЛА (250 г/изделие, 2 изделия) — изолированный
 *     mock, реальные бизнес-данные не затрагиваются;
 *   • превышение → 422 WRITE_OFF_SNAPSHOT_MISMATCH (kind: overage) с
 *     expected_remaining/got;
 *   • явное подтверждение оператора (allow_overage: true) → 201 как ручная
 *     корректировка: причина в журнале движений помечена, snapshot не правится;
 *   • позиция вне состава snapshot → 422 (kind: not_in_snapshot);
 *   • несовместимые единицы нормы↔склада → 422 (kind: unit_mismatch);
 *   • кумулятивный учёт: уже списанное (реестр 0049) вычитается из норматива —
 *     прогрессивное списание частями работает, кумулятивное превышение нет;
 *   • легаси-заказ БЕЗ snapshot — прежнее поведение (валидации нет);
 *   • повреждённый snapshot → 422 SNAPSHOT_INVALID (fail-closed, не fail-open);
 *   • повтор того же батча → идемпотентный replay ДО валидации (0049 не изменён).
 *
 * Пул и supabaseAdmin замоканы canned-ответами по SQL-признакам — реальная БД
 * не затрагивается.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const OWNER = "11111111-1111-4111-8111-111111111101";
const ORDER_ID = "5828a175-c3b0-43e3-a6c2-303881948a38";
const P1 = "aaaaaaaa-0000-4000-8000-00000000c001";
const BERRY = "609a0d84-5ad4-4c0d-8eff-06ed6d51c616"; // склад: кг
const FLOUR = "817dc734-983d-4b95-8a66-fc13c3b9d2c8"; // склад: г
const OUTSIDER = "c0ffee00-0000-4000-8000-00000000c099";

// --- Состояние «БД» (canned) ---
let orderRow: { confectioner_id: string | null; metadata: string | null } | null;
let orderItemRows: Array<{ product_id: string | null; quantity: number }>;
let inventoryRows: Array<{ id: string; name: string; unit: string | null }>;
let registryRows: Array<{ items: unknown }>;

/** Валидный snapshot: 250 г ягод + 0.2 кг муки НА 1 изделие × 2 изделия. */
function validSnapshotMetadata(): string {
  return JSON.stringify({
    acceptance_snapshot: {
      schema_version: 1,
      snapshot_id: "3f1d2b8a-1111-4222-8333-444455556666",
      created_at: "2026-11-11T18:00:00.000Z",
      source: "checkout",
      legacy: false,
      items: [
        {
          product_id: P1,
          title: "Ягодный бархат",
          quantity: 2,
          recipe_id: "8806b15e-7d98-44b5-965d-05ba64b48cc7",
          recipe_version_id: null,
          recipe_updated_at: "2026-11-11T17:00:00.000Z",
          production_time_hours: 6,
          prep_time_minutes: 30,
          cook_time_minutes: 45,
          category_slug: "cakes",
          ingredients: [
            { name: "Ягоды", qty: 250, unit: "г", inventory_item_id: BERRY },
            { name: "Мука", qty: 0.2, unit: "кг", inventory_item_id: null },
          ],
        },
      ],
    },
  });
}

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      if (sql.includes("FROM public.orders")) {
        return { rows: orderRow ? [orderRow] : [], rowCount: orderRow ? 1 : 0 };
      }
      if (sql.includes("FROM public.order_items")) {
        return { rows: orderItemRows, rowCount: orderItemRows.length };
      }
      if (sql.includes("FROM public.inventory_items")) {
        return { rows: inventoryRows, rowCount: inventoryRows.length };
      }
      if (sql.includes("FROM public.inventory_write_offs")) {
        return { rows: registryRows, rowCount: registryRows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  }),
}));

// --- supabaseAdmin: реестр inventory_write_offs (find/insert) ---
const dbState = {
  registry: null as Record<string, unknown> | null,
  registryInserts: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const api: Record<string, unknown> = {};
      const rec = (op: string) => (...args: unknown[]) => {
        if (op === "insert" && table === "inventory_write_offs") {
          dbState.registryInserts.push(args[0] as Record<string, unknown>);
        }
        return api;
      };
      Object.assign(api, {
        select: rec("select"),
        insert: rec("insert"),
        update: rec("update"),
        eq: rec("eq"),
        maybeSingle: () => Promise.resolve({ data: dbState.registry, error: null }),
        then: (
          onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
          onRejected?: (e: unknown) => unknown
        ) => Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected),
        catch: (onRejected: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).catch(onRejected),
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

// Движок движений (0048 RPC) — очередь результатов + запись вызовов.
type MovementResult =
  | { ok: true; item: { id: string; name: string; quantity: number; unit: string }; movement: { id: string } }
  | { ok: false; error: { kind: "insufficient" | "not_found" | "forbidden" | "unknown"; available?: number } };
let movementQueue: MovementResult[];
let movementCalls: Array<{ item_id: string; type: string; quantity: number; reason: string | null }>;

vi.mock("@/lib/inventory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inventory")>();
  return {
    ...actual,
    applyInventoryMovement: vi.fn(
      async (_actor: unknown, m: { item_id: string; type: string; quantity: number; reason?: string | null }) => {
        movementCalls.push({
          item_id: m.item_id,
          type: m.type,
          quantity: m.quantity,
          reason: m.reason ?? null,
        });
        const next = movementQueue.shift();
        if (!next) throw new Error("movementQueue empty — тест не настроил очередь");
        return next;
      }
    ),
  };
});

import { POST as postWriteOff } from "./write-off/route";

const okResult = (id: string): MovementResult => ({
  ok: true,
  item: { id, name: `item-${id.slice(0, 6)}`, quantity: 100, unit: "кг" },
  movement: { id: `mv-${id.slice(0, 6)}` },
});

const req = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost:3000/api/inventory/write-off", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  orderRow = { confectioner_id: OWNER, metadata: validSnapshotMetadata() };
  orderItemRows = [{ product_id: P1, quantity: 2 }];
  inventoryRows = [
    { id: BERRY, name: "Ягоды", unit: "кг" },
    { id: FLOUR, name: "Мука", unit: "г" },
  ];
  registryRows = [];
  dbState.registry = null;
  dbState.registryInserts = [];
  movementQueue = [okResult(BERRY), okResult(FLOUR), okResult(BERRY), okResult(FLOUR)];
  movementCalls = [];
});

describe("POST /api/inventory/write-off — валидация по snapshot заказа (Z-v30)", () => {
  it("списание по нормативу snapshot (0.5 кг = 500 г × 2 изделия) → 201", async () => {
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { applied: unknown[]; failed: unknown[] };
    expect(json.applied).toHaveLength(1);
    expect(json.failed).toHaveLength(0);
    expect(movementCalls[0].item_id).toBe(BERRY);
    expect(movementCalls[0].quantity).toBe(0.5);
  });

  it("превышение норматива (1 кг вместо 0.5) → 422 WRITE_OFF_SNAPSHOT_MISMATCH kind=overage", async () => {
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 1 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as {
      error: string;
      deviations: Array<{ item_id: string; kind: string; expected_remaining: number | null; got: number }>;
    };
    expect(json.error).toBe("WRITE_OFF_SNAPSHOT_MISMATCH");
    expect(json.deviations).toHaveLength(1);
    expect(json.deviations[0].kind).toBe("overage");
    expect(json.deviations[0].expected_remaining).toBeCloseTo(0.5, 6);
    expect(json.deviations[0].got).toBe(1);
    expect(movementCalls).toHaveLength(0); // списание НЕ выполнено
  });

  it("allow_overage: true → 201 как ручная корректировка, причина помечена в журнале", async () => {
    const res = await postWriteOff(
      req({
        order_id: ORDER_ID,
        items: [{ item_id: BERRY, quantity: 1 }],
        reason: "Фактический расход выше (брак части ягод)",
        allow_overage: true,
      })
    );
    expect(res.status).toBe(201);
    expect(movementCalls).toHaveLength(1);
    expect(movementCalls[0].reason).toContain("превышение норматива snapshot подтверждено оператором");
    // snapshot заказа не переписывается: insert в orders отсутствует по контракту роута
  });

  it("позиция вне состава snapshot → 422 kind=not_in_snapshot", async () => {
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: OUTSIDER, quantity: 5 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { deviations: Array<{ kind: string }> };
    expect(json.deviations[0].kind).toBe("not_in_snapshot");
    expect(movementCalls).toHaveLength(0);
  });

  it("несовместимые единицы нормы и склада → 422 kind=unit_mismatch", async () => {
    // Норма «Ягоды» в г, складская позиция переключена на л (объём) — не переводимо.
    inventoryRows = [{ id: BERRY, name: "Ягоды", unit: "л" }];
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { deviations: Array<{ kind: string }> };
    expect(json.deviations[0].kind).toBe("unit_mismatch");
    expect(movementCalls).toHaveLength(0);
  });

  it("кумулятивный учёт: уже списано 0.3 кг → остаток 0.2; 0.25 отклоняется, 0.2 проходит", async () => {
    registryRows = [{ items: [{ item_id: BERRY, quantity: 0.3 }] }];
    const res1 = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.25 }] })
    );
    expect(res1.status).toBe(422);
    const j1 = (await res1.json()) as { deviations: Array<{ kind: string; expected_remaining: number }> };
    expect(j1.deviations[0].kind).toBe("overage");
    expect(j1.deviations[0].expected_remaining).toBeCloseTo(0.2, 6);

    const res2 = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.2 }] })
    );
    expect(res2.status).toBe(201);
  });

  it("погрешность округления не блокирует: 0.5000001 ≈ 0.5 → 201", async () => {
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 + 1e-7 }] })
    );
    expect(res.status).toBe(201);
  });

  it("легаси-заказ без snapshot → прежнее поведение, произвольные количества проходят", async () => {
    orderRow = { confectioner_id: OWNER, metadata: JSON.stringify({ cart_items: ["ci_1"] }) };
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 999 }] })
    );
    expect(res.status).toBe(201);
    expect(movementCalls).toHaveLength(1);
    expect(movementCalls[0].quantity).toBe(999);
    expect(movementCalls[0].reason).not.toContain("превышение");
  });

  it("повреждённый snapshot (чужая schema_version) → 422 SNAPSHOT_INVALID, движок НЕ вызывается", async () => {
    orderRow = {
      confectioner_id: OWNER,
      metadata: JSON.stringify({
        acceptance_snapshot: { schema_version: 99, items: [] },
      }),
    };
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("SNAPSHOT_INVALID");
    expect(movementCalls).toHaveLength(0);
  });

  it("snapshot не соответствует позициям заказа (подмена) → 422 SNAPSHOT_INVALID", async () => {
    orderItemRows = [{ product_id: P1, quantity: 5 }]; // а snapshot на 2
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("SNAPSHOT_INVALID");
    expect(movementCalls).toHaveLength(0);
  });

  it("повтор того же батча → идемпотентный replay 200 ДО валидации (контракт 0049 сохранён)", async () => {
    dbState.registry = {
      id: "reg-1",
      items: [{ item_id: BERRY, quantity: 0.5 }],
      result: { applied: [{ item_id: BERRY, quantity: 0.5, movement_id: "mv-1" }], failed: [] },
      created_at: new Date().toISOString(),
    };
    // Даже количество вне норматива не важно: replay возвращает сохранённый результат
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { idempotent: boolean; duplicate: boolean };
    expect(json.idempotent).toBe(true);
    expect(json.duplicate).toBe(true);
    expect(movementCalls).toHaveLength(0);
  });

  it("заказ не найден → прежнее поведение (валидация пропускается)", async () => {
    orderRow = null;
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 3 }] })
    );
    expect(res.status).toBe(201);
    expect(movementCalls).toHaveLength(1);
  });
});
