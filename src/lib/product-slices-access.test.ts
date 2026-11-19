import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  let result: { data: unknown; error: { message: string } | null } = { data: null, error: null };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  };
  query.select.mockImplementation(() => query);
  query.eq.mockImplementation(() => query);
  const from = vi.fn(() => query);
  return { from, query, setResult(value: typeof result) { result = value; } };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: mocked.from } }));

import { assertProductSliceOwnership } from "@/lib/product-slices-access";

describe("assertProductSliceOwnership", () => {
  beforeEach(() => {
    mocked.setResult({ data: null, error: null });
    mocked.from.mockClear();
    mocked.query.select.mockClear();
    mocked.query.eq.mockClear();
    mocked.query.maybeSingle.mockClear();
  });

  it("разрешает запись владельцу товара", async () => {
    mocked.setResult({ data: { id: "product-1", confectioner_id: "user-1" }, error: null });
    await expect(assertProductSliceOwnership("product-1", "user-1")).resolves.toBeUndefined();
    expect(mocked.from).toHaveBeenCalledWith("products");
    expect(mocked.query.eq).toHaveBeenCalledWith("id", "product-1");
  });

  it("запрещает изменение чужого товара", async () => {
    mocked.setResult({ data: { id: "product-1", confectioner_id: "owner-2" }, error: null });
    await expect(assertProductSliceOwnership("product-1", "user-1")).rejects.toMatchObject({ status: 403 });
  });

  it("не разрешает запись, если товар отсутствует", async () => {
    mocked.setResult({ data: null, error: null });
    await expect(assertProductSliceOwnership("missing", "user-1")).rejects.toMatchObject({ status: 404 });
  });

  it("закрывает запись при ошибке БД", async () => {
    mocked.setResult({ data: null, error: { message: "connection refused" } });
    await expect(assertProductSliceOwnership("product-1", "user-1")).rejects.toMatchObject({ status: 500 });
  });

  it("закрывает запись, если у товара отсутствует владелец", async () => {
    mocked.setResult({ data: { id: "product-1", confectioner_id: null }, error: null });
    await expect(assertProductSliceOwnership("product-1", "user-1")).rejects.toMatchObject({ status: 403 });
  });
});
