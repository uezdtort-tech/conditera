/**
 * Тесты POST /api/admin/price-history/correct (ADMIN/SUPER_ADMIN only).
 *
 * Покрытие: не-админ → 403; невалидный versionId → 400; закрытая историческая
 * строка → 400 HISTORICAL_IMMUTABLE (задним числом менять запрещено);
 * текущая открытая строка → 200 + вызов set_product_price(source
 * 'admin_correction') + запись в product_price_audit с деталями коррекции.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const VERSION_ID = "e0000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "a0000000-0000-4000-8000-000000000001";
const ADMIN_USER_ID = "c0000000-0000-4000-8000-000000000003";

const { state, poolQueryMock, userMock, adminMock } = vi.hoisted(() => {
  const state = {
    versionRows: [] as unknown[],
    setRows: [] as unknown[],
    setErr: null as { code?: string; message?: string } | null,
    auditRows: [] as unknown[],
  };
  return {
    state,
    poolQueryMock: vi.fn(),
    userMock: vi.fn(),
    adminMock: vi.fn(),
  };
});

vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({
    query: poolQueryMock,
    // withTransaction: закреплённый клиент (BEGIN/COMMIT через тот же мок)
    connect: async () => ({ query: poolQueryMock, release: vi.fn() }),
  }),
}));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => userMock(...args),
}));
vi.mock("@/lib/role-guards", () => ({
  isAdmin: (...args: unknown[]) => adminMock(...args),
}));

function router(sql: string): { rows: unknown[] } {
  const q = sql.trim();
  if (/FROM public\.product_price_history\s+WHERE id = \$1/.test(q)) {
    return { rows: state.versionRows };
  }
  if (/set_product_price/.test(q)) {
    if (state.setErr) {
      throw Object.assign(new Error(state.setErr.message ?? "pg error"), state.setErr);
    }
    return { rows: state.setRows.map((result) => ({ result })) };
  }
  if (/INSERT INTO public\.product_price_audit/.test(q)) {
    state.auditRows.push(q);
    return { rows: [] };
  }
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(q)) return { rows: [] };
  return { rows: [] };
}

import { POST } from "./route";

function openVersionRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VERSION_ID,
    product_id: PRODUCT_ID,
    product_variant_id: null,
    amount: 5000,
    effective_from: "2026-01-01T00:00:00.000Z", // в прошлом относительно «сейчас»
    effective_to: null,
    ...extra,
  };
}

async function callPost(body: unknown): Promise<Response> {
  const request = new NextRequest("http://localhost:3000/api/admin/price-history/correct", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(request);
}

beforeEach(() => {
  poolQueryMock.mockReset();
  poolQueryMock.mockImplementation((sql: string) => router(sql));
  userMock.mockReset();
  userMock.mockResolvedValue({ id: ADMIN_USER_ID, userId: ADMIN_USER_ID });
  adminMock.mockReset();
  adminMock.mockResolvedValue(true);
  state.versionRows = [openVersionRow()];
  state.setRows = [];
  state.setErr = null;
  state.auditRows = [];
});

describe("POST /api/admin/price-history/correct", () => {
  it("не-админ → 403 (версию даже не ищем)", async () => {
    adminMock.mockResolvedValue(false);
    const res = await callPost({ versionId: VERSION_ID, newAmount: 5500, reason: "other" });
    expect(res.status).toBe(403);
    const calls = poolQueryMock.mock.calls as Array<[string]>;
    expect(calls.some(([sql]) => /product_price_history/.test(sql))).toBe(false);
  });

  it("невалидный versionId (не uuid) → 400 VALIDATION_FAILED", async () => {
    const res = await callPost({ versionId: "not-a-uuid", newAmount: 5500, reason: "other" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILED");
  });

  it("закрытая историческая строка → 400 HISTORICAL_IMMUTABLE, без мутаций", async () => {
    state.versionRows = [
      openVersionRow({ effective_to: "2026-02-01T00:00:00.000Z" }), // закрыта
    ];
    const res = await callPost({ versionId: VERSION_ID, newAmount: 5500, reason: "other" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("HISTORICAL_IMMUTABLE");
    const calls = poolQueryMock.mock.calls as Array<[string]>;
    expect(calls.some(([sql]) => /set_product_price/.test(sql))).toBe(false);
    expect(state.auditRows).toHaveLength(0);
  });

  it("D4 (PR-6A2): активная строка, закрытая на planned-границе (to > now) → 200", async () => {
    // Плановая версия существует → активная строка закрыта на её effective_to,
    // но всё ещё действует: коррекция ДОЛЖНА проходить (раньше был 400).
    const futureTo = new Date(Date.now() + 60 * 60_000).toISOString();
    state.versionRows = [openVersionRow({ effective_to: futureTo })];
    state.setRows = [
      { versionId: "e0000000-0000-4000-8000-000000000002", noChange: false },
    ];
    const res = await callPost({ versionId: VERSION_ID, newAmount: 5500, reason: "other" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ newVersionId: "e0000000-0000-4000-8000-000000000002", oldAmount: 5000, newAmount: 5500 });
    expect(state.auditRows).toHaveLength(1);
  });

  it("будущая (planned) строка → тоже HISTORICAL_IMMUTABLE (effective_from > now)", async () => {
    state.versionRows = [
      openVersionRow({ effective_from: "2099-01-01T00:00:00.000Z" }),
    ];
    const res = await callPost({ versionId: VERSION_ID, newAmount: 5500, reason: "other" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("HISTORICAL_IMMUTABLE");
    // Честное сообщение: плановая строка ещё не активна — перепланировать может кондитер
    expect(String(json.message)).toContain("перепланировать");
  });

  it("текущая открытая строка: 200 + set_product_price('admin_correction') + аудит", async () => {
    state.setRows = [
      { versionId: "e0000000-0000-4000-8000-000000000002", noChange: false },
    ];
    const res = await callPost({
      versionId: VERSION_ID,
      newAmount: 5500,
      reason: "ingredients",
      comment: "поставщик поднял цены",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      newVersionId: "e0000000-0000-4000-8000-000000000002",
      oldAmount: 5000,
      newAmount: 5500,
      deltaRub: 500,
      deltaPercent: 10,
    });

    // set_product_price вызван с source='admin_correction', actor=admin
    const calls = poolQueryMock.mock.calls as Array<[string, unknown[]]>;
    const setCall = calls.find(([sql]) => /set_product_price/.test(sql));
    expect(setCall).toBeDefined();
    expect(setCall![1][0]).toBe(ADMIN_USER_ID);
    expect(setCall![1][7]).toBe("admin_correction");
    expect(setCall![1][10]).toBe(true);

    // Аудит: action 'admin_correction', details с correctedVersionId/oldAmount/newAmount
    const auditCall = calls.find(([sql]) => /INSERT INTO public\.product_price_audit/.test(sql));
    expect(auditCall).toBeDefined();
    expect(String(auditCall![0])).toContain("'admin_correction'");
    const details = JSON.parse(String(auditCall![1][3]));
    expect(details).toEqual({
      correctedVersionId: VERSION_ID,
      oldAmount: 5000,
      newAmount: 5500,
    });

    // Транзакция закрыта COMMIT-ом
    expect(calls.some(([sql]) => /^COMMIT/.test(sql.trim()))).toBe(true);
  });

  it("noChange (сумма не изменилась): 200 без записи аудита", async () => {
    state.setRows = [{ versionId: VERSION_ID, noChange: true }];
    const res = await callPost({ versionId: VERSION_ID, newAmount: 5000, reason: "other" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.noChange).toBe(true);
    expect(state.auditRows).toHaveLength(0);
  });
});
