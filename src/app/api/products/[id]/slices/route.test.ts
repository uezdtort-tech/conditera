import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  type DbResult = { data: unknown; error: { message: string } | null };
  type Query = {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };

  const state = {
    user: { userId: "auth-user-1", roles: ["CONFECTIONER"] },
    confectioner: { data: { id: "confectioner-1" }, error: null } as DbResult,
    product: { data: { id: "product-1", confectioner_id: "auth-user-1", status: "published", deleted_at: null }, error: null } as DbResult,
    inserted: { data: { id: "slice-1", productId: "product-1" }, error: null } as DbResult,
    deleted: { data: { id: "slice-1" }, error: null } as DbResult,
    insertPayload: null as Record<string, unknown> | null,
    fromCalls: [] as string[],
  };

  const from = vi.fn((table: string) => {
    state.fromCalls.push(table);
    const query = {} as Query;
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.insert = vi.fn((payload: Record<string, unknown>) => {
      state.insertPayload = payload;
      return query;
    });
    query.delete = vi.fn(() => query);
    query.single = vi.fn(async () => state.inserted);
    query.maybeSingle = vi.fn(async () => {
      if (table === "confectioners") return state.confectioner;
      if (table === "products") return state.product;
      return state.deleted;
    });
    return query;
  });

  return { state, from };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => mocks.state.user),
}));

import { POST, DELETE } from "@/app/api/products/[id]/slices/route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/products/product-1/slices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest() {
  return new NextRequest("http://localhost/api/products/product-1/slices?sliceId=slice-1", {
    method: "DELETE",
  });
}

describe("product slices API persistence and access", () => {
  beforeEach(() => {
    mocks.state.user = { userId: "auth-user-1", roles: ["CONFECTIONER"] };
    mocks.state.confectioner = { data: { id: "confectioner-1" }, error: null };
    mocks.state.product = { data: { id: "product-1", confectioner_id: "auth-user-1", status: "published", deleted_at: null }, error: null };
    mocks.state.inserted = { data: { id: "slice-1", productId: "product-1" }, error: null };
    mocks.state.deleted = { data: { id: "slice-1" }, error: null };
    mocks.state.insertPayload = null;
    mocks.state.fromCalls = [];
    mocks.from.mockClear();
  });

  it("сохраняет запись с реальным UUID и обязательными временными полями", async () => {
    const response = await POST(postRequest({ fillingName: "Малина", image: "/api/upload/slice.jpg" }), {
      params: Promise.resolve({ id: "product-1" }),
    });

    expect(response.status).toBe(201);
    expect(mocks.state.insertPayload).not.toBeNull();
    expect(mocks.state.insertPayload?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mocks.state.insertPayload?.createdAt).toEqual(expect.any(String));
    expect(mocks.state.insertPayload?.updatedAt).toEqual(mocks.state.insertPayload?.createdAt);
    expect(mocks.state.fromCalls).toEqual(["confectioners", "products", "product_slices"]);
  });

  it("не создаёт запись, если проверка владельца завершилась ошибкой БД", async () => {
    mocks.state.product = { data: null, error: { message: "database unavailable" } };

    const response = await POST(postRequest({ fillingName: "Малина", image: "/api/upload/slice.jpg" }), {
      params: Promise.resolve({ id: "product-1" }),
    });

    expect(response.status).toBe(500);
    expect(mocks.state.fromCalls).toEqual(["confectioners", "products"]);
    expect(mocks.state.insertPayload).toBeNull();
  });

  it("не позволяет кондитеру удалить разрез чужого товара", async () => {
    mocks.state.product = { data: { id: "product-1", confectioner_id: "auth-user-2", status: "published", deleted_at: null }, error: null };

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: "product-1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.state.fromCalls).toEqual(["confectioners", "products"]);
  });

  it("возвращает 404, если удаляемый разрез отсутствует", async () => {
    mocks.state.deleted = { data: null, error: null };

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: "product-1" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.state.fromCalls).toEqual(["confectioners", "products", "product_slices"]);
  });
});
