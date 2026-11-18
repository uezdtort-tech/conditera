import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

const mocked = vi.hoisted(() => ({
  results: [] as QueryResult[],
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocked.from,
  },
}));

let auth: typeof import("@/lib/auth");

beforeAll(async () => {
  process.env.JWT_SECRET = "unit-test-jwt-secret-at-least-32-characters";
  process.env.JWT_REFRESH_SECRET = "unit-test-refresh-secret-at-least-32-characters";

  mocked.from.mockImplementation(() => {
    const result = mocked.results.shift() ?? { data: null, error: null };
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = () => query;
    query.maybeSingle = () => Promise.resolve(result);
    query.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return query;
  });

  auth = await import("@/lib/auth");
});

beforeEach(() => {
  mocked.results = [];
  mocked.from.mockClear();
});

describe("getUserFromRequest — серверная проверка актуального состояния учётной записи", () => {
  const userId = "11111111-1111-4111-8111-111111111111";

  async function requestWithToken() {
    const token = await auth.createAccessToken({
      userId,
      email: "stale-token@example.test",
      name: "Устаревшее имя",
      roles: ["SUPER_ADMIN"],
      accountType: "legal",
    });
    return new Request("https://conditera.test/api/private", {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it("возвращает профиль и роли из БД, игнорируя устаревшие claims JWT", async () => {
    mocked.results.push(
      {
        data: {
          id: userId,
          is_blocked: false,
          name: "Актуальное имя",
          email: "current@example.test",
          account_type: "individual",
        },
        error: null,
      },
      { data: [{ role: "CUSTOMER" }], error: null }
    );

    const user = await auth.getUserFromRequest(await requestWithToken());

    expect(user).toMatchObject({
      id: userId,
      userId,
      name: "Актуальное имя",
      email: "current@example.test",
      roles: ["CUSTOMER"],
      accountType: "individual",
    });
    expect(mocked.from).toHaveBeenNthCalledWith(1, "profiles");
    expect(mocked.from).toHaveBeenNthCalledWith(2, "user_roles");
  });

  it("отклоняет JWT, если профиль отсутствует", async () => {
    mocked.results.push({ data: null, error: null });

    await expect(auth.getUserFromRequest(await requestWithToken())).resolves.toBeNull();
    expect(mocked.from).toHaveBeenCalledTimes(1);
  });

  it("отклоняет запрос при ошибке чтения профиля", async () => {
    mocked.results.push({ data: null, error: { message: "database unavailable" } });

    await expect(auth.getUserFromRequest(await requestWithToken())).resolves.toBeNull();
  });

  it("отклоняет заблокированного пользователя", async () => {
    mocked.results.push({
      data: {
        id: userId,
        is_blocked: true,
        name: "Заблокированный",
        email: "blocked@example.test",
        account_type: "individual",
      },
      error: null,
    });

    await expect(auth.getUserFromRequest(await requestWithToken())).resolves.toBeNull();
    expect(mocked.from).toHaveBeenCalledTimes(1);
  });

  it("отклоняет запрос при ошибке загрузки актуальных ролей", async () => {
    mocked.results.push(
      {
        data: {
          id: userId,
          is_blocked: false,
          name: "Пользователь",
          email: "user@example.test",
          account_type: "individual",
        },
        error: null,
      },
      { data: null, error: { message: "role lookup failed" } }
    );

    await expect(auth.getUserFromRequest(await requestWithToken())).resolves.toBeNull();
  });
});
