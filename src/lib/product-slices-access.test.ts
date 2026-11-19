import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  type Result = { data: unknown; error: { message: string } | null };
  let results: Record<string, Result> = {};
  let activeTable = "";
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => results[activeTable] ?? { data: null, error: null }),
  };
  query.select.mockImplementation(() => query);
  query.eq.mockImplementation(() => query);
  const from = vi.fn((table: string) => {
    activeTable = table;
    return query;
  });
  return {
    from,
    query,
    setResults(value: Record<string, Result>) { results = value; },
  };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: mocked.from } }));

import { assertProductSliceOwnership } from "@/lib/product-slices-access";

describe("assertProductSliceOwnership", () => {
  beforeEach(() => {
    mocked.setResults({});
    mocked.from.mockClear();
    mocked.query.select.mockClear();
    mocked.query.eq.mockClear();
    mocked.query.maybeSingle.mockClear();
  });

  it("разрешает запись владельцу по ID профиля кондитера, а не user ID", async () => {
    mocked.setResults({
      confectioners: { data: { id: "confectioner-1" }, error: null },
      products: { data: { id: "product-1", confectioner_id: "confectioner-1" }, error: null },
    });

    await expect(assertProductSliceOwnership("product-1", "auth-user-1")).resolves.toBeUndefined();
    expect(mocked.from).toHaveBeenNthCalledWith(1, "confectioners");
    expect(mocked.from).toHaveBeenNthCalledWith(2, "products");
    expect(mocked.query.eq).toHaveBeenNthCalledWith(1, "userId", "auth-user-1");
    expect(mocked.query.eq).toHaveBeenNthCalledWith(2, "id", "product-1");
  });

  it("запрещает изменение чужого товара", async () => {
    mocked.setResults({
      confectioners: { data: { id: "confectioner-1" }, error: null },
      products: { data: { id: "product-1", confectioner_id: "confectioner-2" }, error: null },
    });
    await expect(assertProductSliceOwnership("product-1", "auth-user-1"))
      .rejects.toMatchObject({ status: 403 });
  });

  it("не разрешает запись без профиля кондитера", async () => {
    mocked.setResults({
      confectioners: { data: null, error: null },
    });
    await expect(assertProductSliceOwnership("product-1", "auth-user-1"))
      .rejects.toMatchObject({ status: 404 });
    expect(mocked.from).toHaveBeenCalledTimes(1);
  });

  it("не разрешает запись, если товар отсутствует", async () => {
    mocked.setResults({
      confectioners: { data: { id: "confectioner-1" }, error: null },
      products: { data: null, error: null },
    });
    await expect(assertProductSliceOwnership("missing", "auth-user-1"))
      .rejects.toMatchObject({ status: 404 });
  });

  it("закрывает запись при ошибке чтения профиля", async () => {
    mocked.setResults({
      confectioners: { data: null, error: { message: "connection refused" } },
    });
    await expect(assertProductSliceOwnership("product-1", "auth-user-1"))
      .rejects.toMatchObject({ status: 500 });
  });

  it("закрывает запись при ошибке чтения товара", async () => {
    mocked.setResults({
      confectioners: { data: { id: "confectioner-1" }, error: null },
      products: { data: null, error: { message: "connection refused" } },
    });
    await expect(assertProductSliceOwnership("product-1", "auth-user-1"))
      .rejects.toMatchObject({ status: 500 });
  });

  it("закрывает запись, если у товара отсутствует владелец", async () => {
    mocked.setResults({
      confectioners: { data: { id: "confectioner-1" }, error: null },
      products: { data: { id: "product-1", confectioner_id: null }, error: null },
    });
    await expect(assertProductSliceOwnership("product-1", "auth-user-1"))
      .rejects.toMatchObject({ status: 403 });
  });
});
