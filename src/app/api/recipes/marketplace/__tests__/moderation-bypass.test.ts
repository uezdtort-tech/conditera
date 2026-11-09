/**
 * Регрессия обхода модерации рецептов (RELEASE-02 §7 / RELEASE-03, аудит 5-b;
 * утраченный коммит b88714b — восстановлен).
 *
 * Лочит 4 контракта:
 *   1) POST /api/recipes/marketplace с is_published:true НЕ публикует:
 *      корень recipes создаётся status='draft' / published_at=null, оффер
 *      is_published=false (публикация — только через publish-core/модерацию),
 *      ответ содержит warning с корректным путём публикации;
 *   2) PATCH /api/recipes/marketplace/:id с is_published:true при
 *      root.status='draft' → 409, оффер НЕ обновляется;
 *   3) POST /api/recipes/marketplace/:id/purchase при offer.is_published=true,
 *      root.status='draft' → 409 «Рецепт не опубликован», заказ НЕ создаётся;
 *   4) POST /api/moderator/action approve собственного рецепта
 *      (author_id === user.id) → 403, publish-core не вызывается.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface DbCall {
  table: string;
  ops: string[];
  payload: Record<string, unknown> | null;
}

interface DbRes {
  data: unknown;
  error: { message: string } | null;
}

const USER = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "mod@test.local" };
const AUTHOR_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ROOT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OFFER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/** Единый мок PostgREST-шима: пишет все цепочки вызовов, ответ — через responder. */
const db = vi.hoisted(() => {
  const calls: DbCall[] = [];
  let responder: (c: DbCall) => DbRes = () => ({ data: null, error: null });

  function makeBuilder(table: string) {
    const call: DbCall = { table, ops: [], payload: null };
    const api: Record<string, unknown> = {};
    const chain =
      (op: string) =>
      (...args: unknown[]) => {
        call.ops.push(op);
        if (op === "insert" || op === "update") {
          call.payload = args[0] as Record<string, unknown>;
        }
        return api;
      };
    const finish = (terminal: string) => {
      call.ops.push(terminal);
      calls.push(call);
      return Promise.resolve(responder(call));
    };
    Object.assign(api, {
      select: chain("select"),
      insert: chain("insert"),
      update: chain("update"),
      delete: chain("delete"),
      upsert: chain("upsert"),
      eq: chain("eq"),
      neq: chain("neq"),
      in: chain("in"),
      or: chain("or"),
      contains: chain("contains"),
      order: chain("order"),
      limit: chain("limit"),
      range: chain("range"),
      maybeSingle: () => finish("maybeSingle"),
      single: () => finish("single"),
      then: (
        onFulfilled: (v: DbRes) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => finish("then").then(onFulfilled, onRejected),
    });
    return api;
  }

  return {
    calls,
    makeBuilder,
    setResponder: (fn: (c: DbCall) => DbRes) => {
      responder = fn;
    },
    reset: () => {
      calls.length = 0;
      responder = () => ({ data: null, error: null });
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => db.makeBuilder(table) },
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => USER),
}));

vi.mock("@/lib/role-guards", () => ({
  requireRole: vi.fn(async () => null),
  requireAnyRole: vi.fn(async () => null),
  isAdmin: vi.fn(async () => false),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
  getClientIP: () => "127.0.0.1",
  RATE_LIMITS: { payment: { limit: 5, windowMs: 60_000 } },
}));

vi.mock("@/lib/yookassa", () => ({
  isYookassaConfigured: () => false,
  createPayment: vi.fn(),
}));

vi.mock("@/lib/recipes/access-resolver", () => ({
  resolveRecipeAccess: vi.fn(),
  gateRecipeContent: vi.fn(),
}));

const ensureRecipeVersionPublished = vi.hoisted(() => vi.fn());

vi.mock("@/lib/recipes/publish-core", () => ({
  ensureRecipeVersionPublished,
}));

import { POST as marketplacePOST } from "../route";
import { PATCH as marketplacePATCH } from "../[id]/route";
import { POST as purchasePOST } from "../[id]/purchase/route";
import { POST as moderatorActionPOST } from "../../../moderator/action/route";

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const MARKETPLACE_BODY = {
  title: "Шоколадный торт с малиной",
  description: "Авторский рецепт",
  base_price: 500,
  steps_json: [{ step_number: 1, description: "Смешать" }],
  ingredients_json: [{ name: "Мука", qty: "300", unit: "г" }],
};

beforeEach(() => {
  db.reset();
  ensureRecipeVersionPublished.mockReset();
});

describe("RELEASE-03 (аудит 5-b): обход модерации рецептов закрыт", () => {
  it("1) POST marketplace is_published:true → корень draft/published_at:null, оффер выключен, в ответе warning", async () => {
    db.setResponder((c) => {
      if (c.table === "recipes" && c.ops.includes("insert")) {
        return { data: { id: ROOT_ID }, error: null };
      }
      if (c.table === "recipe_marketplace" && c.ops.includes("insert")) {
        return { data: { id: OFFER_ID }, error: null };
      }
      return { data: null, error: null }; // slug-uniqueness, double-write — ок
    });

    const res = await marketplacePOST(
      jsonRequest("http://localhost:3000/api/recipes/marketplace", {
        ...MARKETPLACE_BODY,
        is_published: true, // клиентская попытка опубликовать минуя модерацию
      })
    );

    expect(res.status).toBe(201);

    const rootInsert = db.calls.find(
      (c) => c.table === "recipes" && c.ops.includes("insert")
    );
    expect(rootInsert).toBeDefined();
    expect(rootInsert!.payload).toMatchObject({ status: "draft", published_at: null });

    const offerInsert = db.calls.find(
      (c) => c.table === "recipe_marketplace" && c.ops.includes("insert")
    );
    expect(offerInsert).toBeDefined();
    expect(offerInsert!.payload).toMatchObject({
      is_published: false,
      published_at: null,
    });

    const json = (await res.json()) as { warning?: string };
    expect(json.warning).toContain("POST /api/recipes/{id}/publish");
    expect(json.warning).toContain("PATCH /api/recipes/marketplace/{offerId}");
  });

  it("2) PATCH оффера is_published:true при root.status='draft' → 409, оффер не обновляется", async () => {
    db.setResponder((c) => {
      if (c.table === "recipe_marketplace" && c.ops.includes("maybeSingle")) {
        return {
          data: {
            id: OFFER_ID,
            author_id: USER.id,
            slug: "shokoladnyy-tort-s-malinoy",
            title: "Шоколадный торт с малиной",
            is_published: false,
            recipe_id: ROOT_ID,
          },
          error: null,
        };
      }
      if (c.table === "recipes" && c.ops.includes("maybeSingle")) {
        return { data: { id: ROOT_ID, status: "draft" }, error: null };
      }
      return { data: null, error: null };
    });

    const res = await marketplacePATCH(
      jsonRequest(`http://localhost:3000/api/recipes/marketplace/${OFFER_ID}`, {
        is_published: true,
      }),
      { params: Promise.resolve({ id: OFFER_ID }) }
    );

    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("не опубликован");
    // Оффер не должен был обновиться
    expect(
      db.calls.some((c) => c.table === "recipe_marketplace" && c.ops.includes("update"))
    ).toBe(false);
  });

  it("3) purchase при offer.is_published=true и root.status='draft' → 409, заказ не создаётся", async () => {
    db.setResponder((c) => {
      if (c.table === "recipe_marketplace" && c.ops.includes("maybeSingle")) {
        return {
          data: {
            id: OFFER_ID,
            recipe_id: ROOT_ID,
            author_id: AUTHOR_ID,
            title: "Шоколадный торт с малиной",
            slug: "shokoladnyy-tort-s-malinoy",
            base_price: 500,
            royalty_rate: 0.05,
            is_published: true,
          },
          error: null,
        };
      }
      if (c.table === "recipes" && c.ops.includes("maybeSingle")) {
        return { data: { id: ROOT_ID, status: "draft" }, error: null };
      }
      return { data: null, error: null };
    });

    const res = await purchasePOST(
      jsonRequest(`http://localhost:3000/api/recipes/marketplace/${OFFER_ID}/purchase`, {}),
      { params: Promise.resolve({ id: OFFER_ID }) }
    );

    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Рецепт не опубликован");
    expect(db.calls.some((c) => c.table === "orders" && c.ops.includes("insert"))).toBe(false);
  });

  it("4) moderator/action approve собственного рецепта → 403, publish-core не вызывается", async () => {
    db.setResponder((c) => {
      if (c.table === "recipes" && c.ops.includes("maybeSingle")) {
        return {
          data: {
            id: ROOT_ID,
            author_id: USER.id, // модератор — автор рецепта
            title: "Шоколадный торт с малиной",
            slug: "shokoladnyy-tort-s-malinoy",
            status: "pending_review",
            published_at: null,
            updated_at: null,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const res = await moderatorActionPOST(
      jsonRequest("http://localhost:3000/api/moderator/action", {
        type: "recipe",
        id: ROOT_ID,
        action: "approve",
      })
    );

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Модератор не может модерировать собственный рецепт");
    expect(ensureRecipeVersionPublished).not.toHaveBeenCalled();
    // Решения нет — UPDATE/audit_log не пишутся
    expect(
      db.calls.some((c) => c.table === "recipes" && c.ops.includes("update"))
    ).toBe(false);
    expect(db.calls.some((c) => c.table === "audit_log")).toBe(false);
  });
});
