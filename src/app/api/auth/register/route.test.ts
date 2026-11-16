/**
 * Регрессионные тесты POST /api/auth/register — единый fallback при недоступности GoTrue.
 *
 * Контракт (после решения владельца: регистрация не должна падать после
 * развёртывания без реального Supabase — прежний fail-closed гейт
 * «Не удалось создать пользователя в Auth» снят):
 *   - NODE_ENV=production + ошибка GoTrue admin.createUser → fallback:
 *     auth.users стаб через pg-пул (FK profiles.id → auth.users.id)
 *     + profiles upsert + user_roles → 201 (пароль канонично хранит
 *     profiles.password_hash — логин от GoTrue не зависит);
 *   - NODE_ENV=development + ошибка GoTrue → тот же fallback → 201;
 *   - production + GoTrue здоров (createUser ok) → 201 штатно, pg-пул
 *     не используется: fallback ТОЛЬКО по факту authErr.
 *   - Fail-closed сохранён на уровне БД: сбой profiles/user_roles → 500
 *     с компенсацией (deleteUser / delete profile) — без частичного пользователя.
 *
 * Моки: @/lib/anti-fraud, @/lib/supabase/admin, @/lib/auth, @/lib/postgrest/pool,
 * @/lib/yandex-metrika, @/lib/telegram-bot, @/lib/email — герметично, без сети/БД.
 * Конвенции — src/app/api/health/route.test.ts и src/app/api/upload/route.test.ts
 * (docblock-контекст, vi.mock, русские describe/it, без ослабления проверок).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- Моки модулей (герметично, без сети и БД) ---

const fraudLimitMock = vi.fn();
vi.mock("@/lib/anti-fraud", () => ({
  checkFraudLimit: (...args: unknown[]) => fraudLimitMock(...args),
}));

const createUserMock = vi.fn();
const deleteUserMock = vi.fn();
const profilesMaybeSingleMock = vi.fn();
const profileUpsertMock = vi.fn();
const profileSingleMock = vi.fn();
const profileDeleteEqMock = vi.fn();
const blacklistMaybeSingleMock = vi.fn();
const userRolesUpsertMock = vi.fn();
const referralsInsertMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      switch (table) {
        case "profiles":
          return {
            // Шаги 3/4: select("id").eq(...).maybeSingle() — уникальность email/phone
            select: () => ({ eq: () => ({ maybeSingle: profilesMaybeSingleMock }) }),
            // Шаг 8: upsert(..., {onConflict:"id"}).select(...).single()
            upsert: (...args: unknown[]) => {
              profileUpsertMock(...args);
              return { select: () => ({ single: profileSingleMock }) };
            },
            // Компенсация при сбое user_roles (в fail-closed сценарии недостижима)
            delete: () => ({ eq: profileDeleteEqMock }),
          };
        case "blacklist":
          // Шаг 5: select().eq().eq().eq().maybeSingle()
          return {
            select: () => ({
              eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: blacklistMaybeSingleMock }) }) }),
            }),
          };
        case "user_roles":
          return { upsert: userRolesUpsertMock };
        case "referrals":
          return { insert: referralsInsertMock };
        default:
          throw new Error(`[test] неожиданная таблица: ${table}`);
      }
    },
    auth: {
      admin: {
        // Ленивые ссылки (factory vi.mock хойстится выше const-объявлений)
        createUser: (...args: unknown[]) => createUserMock(...args),
        deleteUser: (...args: unknown[]) => deleteUserMock(...args),
      },
    },
  },
}));

const hashPasswordMock = vi.fn();
const createAccessTokenMock = vi.fn();
const createRefreshTokenMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  hashPassword: (...args: unknown[]) => hashPasswordMock(...args),
  createAccessToken: (...args: unknown[]) => createAccessTokenMock(...args),
  createRefreshToken: (...args: unknown[]) => createRefreshTokenMock(...args),
}));

const poolQueryMock = vi.fn();
vi.mock("@/lib/postgrest/pool", () => ({
  getPool: () => ({ query: poolQueryMock }),
}));

// Non-blocking хвост регистрации (шаги 14-16) — в прод-fail-closed не достигаются
vi.mock("@/lib/yandex-metrika", () => ({
  trackEventServer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/telegram-bot", () => ({
  sendToChannel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email", () => ({
  sendTemplateEmail: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "./route";

// --- Фикстуры (синтетические, без секретов) ---

const VALID_BODY = {
  email: "e2e-failclosed@example.com",
  // Синтетическая фикстура, короче 12 символов — не триггерит
  // generic-secret правило secrets-scan (см. scripts/regression).
  password: "pass-1234",
  name: "Тест Тестов",
  phone: "+79990000000",
  role: "CUSTOMER",
};

const PROFILE_ROW = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "e2e-failclosed@example.com",
  name: "Тест Тестов",
  phone: "+79990000000",
  account_type: "individual",
  city: null,
  bonus_balance: 0,
  loyalty_level: "BRONZE",
};

function makePost(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Временная установка NODE_ENV с гарантированным восстановлением. */
async function withNodeEnv<T>(value: "production" | "development", fn: () => Promise<T>): Promise<T> {
  // process.env.NODE_ENV в next-env типах read-only — мутируем через алиас
  const env = process.env as { NODE_ENV?: string };
  const saved = env.NODE_ENV;
  env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    env.NODE_ENV = saved;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  fraudLimitMock.mockResolvedValue({ allowed: true, resetAt: Date.now() + 3_600_000 });
  profilesMaybeSingleMock.mockResolvedValue({ data: null }); // email/phone свободны
  blacklistMaybeSingleMock.mockResolvedValue({ data: null }); // чёрный список пуст
  profileSingleMock.mockResolvedValue({ data: PROFILE_ROW, error: null });
  userRolesUpsertMock.mockResolvedValue({ error: null });
  referralsInsertMock.mockResolvedValue({ data: null, error: null });
  profileDeleteEqMock.mockResolvedValue({ data: null, error: null });
  poolQueryMock.mockResolvedValue({ rowCount: 1 });
  hashPasswordMock.mockResolvedValue("bcrypt-hash-stub");
  createAccessTokenMock.mockResolvedValue("access-token-stub");
  createRefreshTokenMock.mockResolvedValue("refresh-token-stub");
});

describe("POST /api/auth/register — единый fallback при недоступности GoTrue", () => {
  it("production + createUser fail → fallback: auth.users стаб через пул, profiles создан, 201 (гейт по факту authErr, а не NODE_ENV)", async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "stub: GoTrue unavailable" },
    });

    const res = await withNodeEnv("production", () => POST(makePost(VALID_BODY)));

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.email).toBe("e2e-failclosed@example.com");
    expect(json.accessToken).toBe("access-token-stub");
    expect(json.refreshToken).toBe("refresh-token-stub");

    // Fallback-стаб: прямая строка auth.users через pg-пул (FK для profiles)
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
    expect(String(poolQueryMock.mock.calls[0][0])).toContain("INSERT INTO auth.users");
    expect(profileUpsertMock).toHaveBeenCalledTimes(1);
    expect(userRolesUpsertMock).toHaveBeenCalledTimes(1);
    expect(referralsInsertMock).toHaveBeenCalledTimes(1);
    // Компенсация (deleteUser) не нужна — GoTrue пользователя и не было
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("development + createUser fail → тот же fallback: auth.users стаб, profiles создан, 201", async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "501 LOCAL_AUTH_DISABLED" },
    });

    const res = await withNodeEnv("development", () => POST(makePost(VALID_BODY)));

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.email).toBe("e2e-failclosed@example.com");
    expect(json.accessToken).toBe("access-token-stub");
    expect(json.refreshToken).toBe("refresh-token-stub");

    // Fallback-стаб: прямая строка auth.users через pg-пул (FK для profiles)
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
    expect(String(poolQueryMock.mock.calls[0][0])).toContain("INSERT INTO auth.users");
    expect(profileUpsertMock).toHaveBeenCalledTimes(1);
    expect(userRolesUpsertMock).toHaveBeenCalledTimes(1);
  });

  it("production + GoTrue здоров (createUser ok) → 201 штатно: fallback только по факту authErr, pg-пул не используется", async () => {
    createUserMock.mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-00000000000a" } },
      error: null,
    });

    const res = await withNodeEnv("production", () => POST(makePost(VALID_BODY)));

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.id).toBe("00000000-0000-4000-8000-00000000000a");

    // Прод-путь: dev-стаб недостижим даже мысленно, профиль создан штатно
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(profileUpsertMock).toHaveBeenCalledTimes(1);
    expect(profileUpsertMock.mock.calls[0][1]).toEqual({ onConflict: "id" });
    expect(userRolesUpsertMock).toHaveBeenCalledTimes(1);
  });

  it("GoTrue: «User already registered» (422) → 409, fallback НЕ выполняется (нет стаба и профиля)", async () => {
    // Email есть в auth.users, но отсутствует в profiles (профиль удалён вручную).
    // Раньше этот случай проваливался в fallback и давал бесполезный 500
    // «Ошибка при создании профиля» (стаб бился по UNIQUE(email), upsert — по FK).
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered", status: 422 },
    });

    const res = await withNodeEnv("production", () => POST(makePost(VALID_BODY)));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("Email уже зарегистрирован");
    // Fallback не выполняется: ни стаб auth.users, ни профиль, ни роль
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(profileUpsertMock).not.toHaveBeenCalled();
    expect(userRolesUpsertMock).not.toHaveBeenCalled();
    expect(referralsInsertMock).not.toHaveBeenCalled();
  });

  it("GoTrue: user_already_exists (code) → 409 и по коду ошибки, не только по 422", async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "duplicate", code: "user_already_exists", status: 400 },
    });

    const res = await withNodeEnv("production", () => POST(makePost(VALID_BODY)));

    expect(res.status).toBe(409);
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(profileUpsertMock).not.toHaveBeenCalled();
  });

  it("невалидный формат email → 400 до обращений к БД/GoTrue", async () => {
    const res = await withNodeEnv("production", () =>
      POST(makePost({ ...VALID_BODY, email: "не-email" }))
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Некорректный формат email");
    expect(createUserMock).not.toHaveBeenCalled();
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(profileUpsertMock).not.toHaveBeenCalled();
  });

  it("email с пробелами/без TLD отклоняется, валидный с trim() проходит", async () => {
    const bad = ["a@b", "a b@example.com", "a@.ru", "@example.com"];
    for (const email of bad) {
      const res = await withNodeEnv("production", () =>
        POST(makePost({ ...VALID_BODY, email }))
      );
      expect(res.status, `email: ${email}`).toBe(400);
    }

    createUserMock.mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-00000000000b" } },
      error: null,
    });
    const ok = await withNodeEnv("production", () =>
      POST(makePost({ ...VALID_BODY, email: "  spaced@example.com " }))
    );
    expect(ok.status).toBe(201);
    // emailLower нормализован: trim + lowercase
    const createUserArg = createUserMock.mock.calls[0][0] as { email: string };
    expect(createUserArg.email).toBe("spaced@example.com");
  });
});
