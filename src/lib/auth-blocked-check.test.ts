// Тест гоняется в node-окружении (не jsdom): jose v6 требует Uint8Array из
// того же realm, что и globalThis — в jsdom TextEncoder даёт объект другого
// realm и .sign() падает. В рантайме Next.js API-роутов (nodejs runtime)
// этой проблемы нет; здесь тот же node-контекст.
// @vitest-environment node
/**
 * Тесты src/lib/auth.ts — канонический fail-closed контракт
 * (коммит f92478a2 «port fail-closed auth hardening», слияние 2026-11-23).
 *
 * Контракт getUserFromRequest:
 *   • профиль читается из БД на КАЖДЫЙ запрос (кеша в globalThis больше нет);
 *   • профиль отсутствует / is_blocked / deleted_at → null;
 *   • ошибка БД или исключение — ЛЮБОГО метода → null (fail-closed без
 *     исключений для GET/HEAD: прежний fail-open для чтения superseded);
 *   • роли читаются из user_roles на каждый запрос (JWT-claims не источник);
 *   • ошибка чтения ролей → null.
 *
 * JWT — настоящие (jose round-trip через экспортированный createAccessToken),
 * мок — только граница supabaseAdmin. Без сети и БД.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- Мок границы supabaseAdmin (единственная внешняя зависимость) ---

const profilesMaybeSingleMock = vi.fn();
const userRolesSelectMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: profilesMaybeSingleMock }),
          }),
        };
      }
      if (table === "user_roles") {
        return {
          select: () => ({
            // .eq("user_id", ...).eq("is_active", true) — двухшаговая цепочка;
            // финальное звено — ВЫЗОВ мока: await исполняет thenable, а не fn
            eq: () => ({ eq: () => userRolesSelectMock() }),
          }),
        };
      }
      throw new Error(`[test] неожиданная таблица: ${table}`);
    },
  },
}));

import { createAccessToken, getUserFromRequest } from "./auth";

// --- Фикстуры ---

const USER_ID = "00000000-0000-4000-8000-00000000beef";

const TOKEN_PAYLOAD = {
  userId: USER_ID,
  email: "blocked-check@example.com",
  name: "Тест Блокировок",
  roles: ["CUSTOMER"],
  accountType: "individual",
};

async function makeRequest(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
  userId: string = USER_ID
): Promise<NextRequest> {
  const token = await createAccessToken({ ...TOKEN_PAYLOAD, userId });
  return new NextRequest(`http://localhost:3000/api/test`, {
    method,
    headers: { cookie: `cd_session=${token}` },
  });
}

function makeDbResult(options: {
  error?: { message: string };
  blocked?: boolean;
  deleted?: boolean;
  missing?: boolean;
  throw?: boolean;
}) {
  return async () => {
    if (options.throw) {
      throw new Error("connection refused (pg pool exhausted)");
    }
    if (options.error) {
      return { data: null, error: options.error };
    }
    if (options.missing) {
      return { data: null, error: null };
    }
    return {
      data: {
        id: USER_ID,
        is_blocked: options.blocked === true,
        deleted_at: options.deleted === true ? "2026-11-01T00:00:00Z" : null,
        name: "Тест Блокировок",
        email: "blocked-check@example.com",
      },
      error: null,
    };
  };
}

function makeRolesResult(options: {
  error?: { message: string };
  roles?: string[];
}) {
  return async () => {
    if (options.error) {
      return { data: null, error: options.error };
    }
    return { data: (options.roles ?? ["CUSTOMER"]).map((role) => ({ role })), error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  userRolesSelectMock.mockImplementation(makeRolesResult({ roles: ["CUSTOMER"] }));
});

describe("getUserFromRequest — ошибка БД: fail-closed на любом методе", () => {
  it("POST + ошибка БД → null", async () => {
    profilesMaybeSingleMock.mockImplementation(
      makeDbResult({ error: { message: "PostgREST 503" } })
    );
    expect(await getUserFromRequest(await makeRequest("POST"))).toBeNull();
  });

  it("GET + ошибка БД → null (fail-closed без исключений для чтения)", async () => {
    profilesMaybeSingleMock.mockImplementation(
      makeDbResult({ error: { message: "PostgREST 503" } })
    );
    expect(await getUserFromRequest(await makeRequest("GET"))).toBeNull();
  });

  it("HEAD + ошибка БД → null", async () => {
    profilesMaybeSingleMock.mockImplementation(
      makeDbResult({ error: { message: "PostgREST 503" } })
    );
    expect(await getUserFromRequest(await makeRequest("HEAD"))).toBeNull();
  });

  it("PUT/PATCH/DELETE + ошибка БД → null (все мутирующие методы)", async () => {
    profilesMaybeSingleMock.mockImplementation(
      makeDbResult({ error: { message: "PostgREST 503" } })
    );
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const user = await getUserFromRequest(await makeRequest(method));
      expect(user, `method: ${method}`).toBeNull();
    }
  });

  it("GET + исключение при запросе БД → null (throw-путь)", async () => {
    profilesMaybeSingleMock.mockImplementation(makeDbResult({ throw: true }));
    expect(await getUserFromRequest(await makeRequest("GET"))).toBeNull();
  });

  it("POST + исключение при запросе БД → null (throw-путь)", async () => {
    profilesMaybeSingleMock.mockImplementation(makeDbResult({ throw: true }));
    expect(await getUserFromRequest(await makeRequest("POST"))).toBeNull();
  });

  it("ошибка чтения ролей → null (роли — источник истины полномочий)", async () => {
    profilesMaybeSingleMock.mockImplementation(makeDbResult({ blocked: false }));
    userRolesSelectMock.mockImplementation(
      makeRolesResult({ error: { message: "roles lookup failed" } })
    );
    expect(await getUserFromRequest(await makeRequest("GET"))).toBeNull();
  });
});

describe("getUserFromRequest — штатная блокировка и допуск", () => {
  it("заблокированный пользователь → null и для GET, и для POST", async () => {
    profilesMaybeSingleMock.mockImplementation(makeDbResult({ blocked: true }));
    expect(await getUserFromRequest(await makeRequest("GET"))).toBeNull();
    expect(await getUserFromRequest(await makeRequest("POST"))).toBeNull();
  });

  it("отсутствующий профиль → null", async () => {
    profilesMaybeSingleMock.mockImplementation(makeDbResult({ missing: true }));
    expect(await getUserFromRequest(await makeRequest("GET"))).toBeNull();
  });

  it("профиль с deleted_at → null (soft-delete закрывает сессию)", async () => {
    profilesMaybeSingleMock.mockImplementation(makeDbResult({ deleted: true }));
    expect(await getUserFromRequest(await makeRequest("GET"))).toBeNull();
  });

  it("незаблокированный пользователь → AuthenticatedUser с ролями из БД", async () => {
    profilesMaybeSingleMock.mockImplementation(makeDbResult({ blocked: false }));
    const get = await getUserFromRequest(await makeRequest("GET"));
    const post = await getUserFromRequest(await makeRequest("POST"));
    expect(get?.userId).toBe(USER_ID);
    expect(post?.userId).toBe(USER_ID);
    expect(post?.email).toBe("blocked-check@example.com");
    expect(post?.accountType).toBe("individual");
    expect(post?.roles).toEqual(["CUSTOMER"]);
  });

  it("профиль читается на каждый запрос — кеша нет, два запроса = два похода в БД", async () => {
    profilesMaybeSingleMock.mockImplementation(makeDbResult({ blocked: false }));
    await getUserFromRequest(await makeRequest("GET"));
    await getUserFromRequest(await makeRequest("GET"));
    expect(profilesMaybeSingleMock).toHaveBeenCalledTimes(2);
    expect(userRolesSelectMock).toHaveBeenCalledTimes(2);
  });

  it("отзыв роли отражается сразу (claims не источник полномочий)", async () => {
    profilesMaybeSingleMock.mockImplementation(makeDbResult({ blocked: false }));
    const first = await getUserFromRequest(await makeRequest("GET"));
    expect(first?.roles).toEqual(["CUSTOMER"]);
    userRolesSelectMock.mockImplementation(makeRolesResult({ roles: [] }));
    const second = await getUserFromRequest(await makeRequest("GET"));
    expect(second?.roles).toEqual([]);
  });
});

describe("getUserFromRequest — аутентификационные границы", () => {
  it("запрос без токена → null без похода в БД", async () => {
    const req = new NextRequest("http://localhost:3000/api/test", { method: "GET" });
    const user = await getUserFromRequest(req);
    expect(user).toBeNull();
    expect(profilesMaybeSingleMock).not.toHaveBeenCalled();
  });

  it("подделанный/невалидный токен → null без похода в БД", async () => {
    const req = new NextRequest("http://localhost:3000/api/test", {
      method: "POST",
      headers: { cookie: "cd_session=eyJhbGciOiJIUzI1NiJ9.forged.sig" },
    });
    const user = await getUserFromRequest(req);
    expect(user).toBeNull();
    expect(profilesMaybeSingleMock).not.toHaveBeenCalled();
  });
});
