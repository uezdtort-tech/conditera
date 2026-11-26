/**
 * write-off.snapshot-validation.test.ts — order-путь POST /api/inventory/write-off:
 * контракт маршрута с атомарным БД-RPC apply_order_write_off_atomic
 * (Z-v32, ZV31-002, миграция 0081).
 *
 * До Z-v32 route делал check-then-act РАЗДЕЛЬНЫМИ запросами (валидация по
 * snapshot приложением → per-item применение → INSERT реестра) — TOCTOU.
 * Теперь route вызывает ОДИН RPC; валидация snapshot выполняется ВНУТРИ
 * транзакции RPC под блокировкой строки заказа. Этот файл лочит КОНТРАКТ
 * маршрута: аргументы RPC (p_allow_overage/reason/signature), поверхроение
 * ошибок RPC существующими кодами (422 WRITE_OFF_SNAPSHOT_MISMATCH /
 * SNAPSHOT_INVALID / 409 недостаточно / replay 200 / fail-closed 500).
 * Семантика самой валидации (кумулятивный учёт, unit_mismatch, overage)
 * лочится на уровне PostgreSQL — scripts/verify-0081-*.cjs против локальной БД.
 *
 * supabaseAdmin.rpc замокан canned-ответами — реальная БД не затрагивается.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

const OWNER = "11111111-1111-4111-8111-111111111101";
const ORDER_ID = "5828a175-c3b0-43e3-a6c2-303881948a38";
const BERRY = "609a0d84-5ad4-4c0d-8eff-06ed6d51c616";

// --- Canned-ответ RPC + журнал вызовов ---
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
    from: () => {
      throw new Error("order-путь не должен ходить в таблицы напрямую — только RPC 0081");
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

import { POST as postWriteOff } from "./write-off/route";

const req = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost:3000/api/inventory/write-off", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

/** Ожидаемая сигнатура сервера: sha256 отсортированных "item_id:quantity". */
const expectedSignature = (items: Array<{ item_id: string; quantity: number }>) =>
  createHash("sha256")
    .update([...items].map((i) => `${i.item_id}:${i.quantity}`).sort().join("|"))
    .digest("hex");

const appliedRow = {
  item_id: BERRY,
  item_name: "Ягоды",
  movement_id: "mv-1",
  quantity: 0.5,
  remaining: 12.5,
  unit: "кг",
};

beforeEach(() => {
  rpcState.calls = [];
  rpcState.data = null;
  rpcState.error = null;
});

describe("POST /api/inventory/write-off (order-путь) — контракт RPC 0081 (ZV31-002)", () => {
  it("списание по нормативу → ОДИН вызов apply_order_write_off_atomic → 201", async () => {
    rpcState.data = { applied: [appliedRow], failed: [], order_id: ORDER_ID, idempotent: false };
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { applied: unknown[]; failed: unknown[]; order_id: string };
    expect(json.applied).toHaveLength(1);
    expect(json.failed).toHaveLength(0);
    expect(json.order_id).toBe(ORDER_ID);

    expect(rpcState.calls).toHaveLength(1);
    const call = rpcState.calls[0];
    expect(call.name).toBe("apply_order_write_off_atomic");
    expect(call.args.p_owner_id).toBe(OWNER);
    expect(call.args.p_order_id).toBe(ORDER_ID);
    expect(call.args.p_items).toEqual([{ item_id: BERRY, quantity: 0.5 }]);
    expect(call.args.p_signature).toBe(expectedSignature([{ item_id: BERRY, quantity: 0.5 }]));
    expect(call.args.p_allow_overage).toBe(false);
    expect(String(call.args.p_reason)).toContain("Списание по заказу");
  });

  it("превышение норматива → RPC RAISE snapshot_mismatch → 422 WRITE_OFF_SNAPSHOT_MISMATCH с deviations", async () => {
    rpcState.error = Object.assign(
      new Error(
        `[order_write_off] snapshot_mismatch:[{"item_id":"${BERRY}","kind":"overage","expected_remaining":0.5,"got":1}]`
      ),
      { code: "P0001" }
    );
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 1 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as {
      error: string;
      deviations: Array<{ item_id: string; kind: string; expected_remaining: number; got: number }>;
      validation_mode: string;
    };
    expect(json.error).toBe("WRITE_OFF_SNAPSHOT_MISMATCH");
    expect(json.validation_mode).toBe("snapshot");
    expect(json.deviations).toHaveLength(1);
    expect(json.deviations[0].kind).toBe("overage");
    expect(json.deviations[0].expected_remaining).toBeCloseTo(0.5, 6);
    expect(json.deviations[0].got).toBe(1);
  });

  it("allow_overage: true → p_allow_overage=true в RPC, причина передаётся как есть (маркер ставит RPC)", async () => {
    rpcState.data = { applied: [appliedRow], failed: [], order_id: ORDER_ID, idempotent: false };
    const res = await postWriteOff(
      req({
        order_id: ORDER_ID,
        items: [{ item_id: BERRY, quantity: 1 }],
        reason: "Фактический расход выше (брак части ягод)",
        allow_overage: true,
      })
    );
    expect(res.status).toBe(201);
    expect(rpcState.calls[0].args.p_allow_overage).toBe(true);
    expect(rpcState.calls[0].args.p_reason).toBe("Фактический расход выше (брак части ягод)");
  });

  it("позиция вне состава snapshot → 422 kind=not_in_snapshot (payload RPC пробрасывается)", async () => {
    rpcState.error = Object.assign(
      new Error(
        `[order_write_off] snapshot_mismatch:[{"item_id":"c0ffee00-0000-4000-8000-00000000c099","kind":"not_in_snapshot","expected_remaining":null,"got":5}]`
      ),
      { code: "P0001" }
    );
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: "c0ffee00-0000-4000-8000-00000000c099", quantity: 5 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { deviations: Array<{ kind: string }> };
    expect(json.deviations[0].kind).toBe("not_in_snapshot");
  });

  it("несовместимые единицы → 422 kind=unit_mismatch", async () => {
    rpcState.error = Object.assign(
      new Error(
        `[order_write_off] snapshot_mismatch:[{"item_id":"${BERRY}","kind":"unit_mismatch","expected_remaining":null,"got":0.5}]`
      ),
      { code: "P0001" }
    );
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { deviations: Array<{ kind: string }> };
    expect(json.deviations[0].kind).toBe("unit_mismatch");
  });

  it("повреждённый snapshot → 422 SNAPSHOT_INVALID (fail-closed)", async () => {
    rpcState.error = Object.assign(
      new Error("[order_write_off] snapshot_invalid:unknown_schema_version"),
      { code: "P0001" }
    );
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("SNAPSHOT_INVALID");
    expect(json.message).toContain("Повреждён snapshot");
  });

  it("snapshot не соответствует позициям заказа → 422 SNAPSHOT_INVALID (coverage)", async () => {
    rpcState.error = Object.assign(
      new Error(`[order_write_off] snapshot_invalid:quantity_mismatch:${ORDER_ID}`),
      { code: "P0001" }
    );
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("SNAPSHOT_INVALID");
    expect(json.message).toContain("не соответствует позициям заказа");
  });

  it("нехватка по всем позициям → 409, failed[] восстановлен из payload RAISE", async () => {
    rpcState.error = Object.assign(
      new Error(
        `[order_write_off] apply_failed:insufficient:[{"item_id":"${BERRY}","error":"Недостаточно на складе: доступно 0.5"}]`
      ),
      { code: "P0001" }
    );
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 2 }] })
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string; failed: Array<{ item_id: string; error: string }> };
    expect(json.error).toContain("Недостаточно на складе: доступно 0.5");
    expect(json.failed).toHaveLength(1);
  });

  it("чужая позиция склада → 403 (apply_failed:forbidden)", async () => {
    rpcState.error = Object.assign(
      new Error(
        `[order_write_off] apply_failed:forbidden:[{"item_id":"${BERRY}","error":"Нет доступа к этой позиции склада"}]`
      ),
      { code: "P0001" }
    );
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 1 }] })
    );
    expect(res.status).toBe(403);
  });

  it("повтор того же батча → идемпотентный replay 200 (idempotent/duplicate) ДО валидации", async () => {
    rpcState.data = {
      idempotent: true,
      order_id: ORDER_ID,
      applied: [appliedRow],
      failed: [],
    };
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { idempotent: boolean; duplicate: boolean; message: string };
    expect(json.idempotent).toBe(true);
    expect(json.duplicate).toBe(true);
    expect(json.message).toContain("уже было выполнено");
    expect(rpcState.calls).toHaveLength(1); // replay решает RPC (реестр-первым)
  });

  it("RPC отсутствует (PGRST202) → 500 fail-closed, повторного небезопасного пути нет", async () => {
    rpcState.error = Object.assign(new Error("Could not find the function"), { code: "PGRST202" });
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0.5 }] })
    );
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("0119");
  });

  it("некорректная позиция от клиента → 400 до RPC", async () => {
    const res = await postWriteOff(
      req({ order_id: ORDER_ID, items: [{ item_id: BERRY, quantity: 0 }] })
    );
    expect(res.status).toBe(400);
    expect(rpcState.calls).toHaveLength(0);
  });
});
