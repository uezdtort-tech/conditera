// node-environment: jose v6 (webapi-сборка) проверяет payload через
// instanceof Uint8Array — в jsdom-реалме TextEncoder даёт объект чужого реалма.
// @vitest-environment node
/**
 * Регрессия «истёкший токен» (RELEASE-GATE-v4.5, P0-C production auth):
 *
 *   • access-токен с истёкшим exp → verifyAccessToken → null (защищённый
 *     маршрут обязан отвечать 401 — восстановление сессии через refresh
 *     покрыто E2E integration-auth-flow, шаг «refresh-токен → новый access»);
 *   • refresh-токен с истёкшим exp → verifyRefreshToken → null;
 *   • токен, подписанный ЧУЖИМ секретом → null (подмена секрета не проходит);
 *   • валидный токен по-прежнему верифицируется (sanity — ассерты не ослаблены).
 *
 * Секреты задаются ДО импорта auth.ts (module-level getSecretEnv — fail-closed).
 * Токены с истёкшим exp подписываются напрямую через jose теми же секретами:
 * createAccessToken/setExpirationTime не позволяет задать exp в прошлом.
 */
import { describe, it, expect, vi } from "vitest";

// vi.hoisted: статические импорты всплывают ВВЕРХ — auth.ts читает секреты
// на уровне модуля (getSecretEnv, fail-closed). Без hoisted env-присваивания
// выполнились бы ПОСЛЕ импорта auth.ts (классическая ловушка vitest).
vi.hoisted(() => {
  process.env.JWT_SECRET ||= "unit_test_jwt_secret_value_32_chars_min_aaaaaaaa";
  process.env.JWT_REFRESH_SECRET ||= "unit_test_jwt_refresh_secret_value_32_chars_aaaaaaaa";
});

import { SignJWT } from "jose";
import {
  verifyAccessToken,
  verifyRefreshToken,
  createAccessToken,
  type JwtPayload,
} from "@/lib/auth";

const accessSecret = new TextEncoder().encode(process.env.JWT_SECRET);
const refreshSecret = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET);

function signExpired(secret: Uint8Array, payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60) // exp в прошлом
    .sign(secret);
}

const basePayload: JwtPayload = { userId: "u-1", email: "expired@test.local", roles: ["CUSTOMER"] };

describe("auth: истёкший/поддельный токен → null (fail-closed)", () => {
  it("access-токен с истёкшим exp → null", async () => {
    const token = await signExpired(accessSecret, basePayload);
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it("refresh-токен с истёкшим exp → null", async () => {
    const token = await signExpired(refreshSecret, basePayload);
    await expect(verifyRefreshToken(token)).resolves.toBeNull();
  });

  it("access-токен, подписанный чужим секретом → null", async () => {
    const foreign = new TextEncoder().encode("attacker_controlled_secret_value_32_chars_aaaa");
    const token = await new SignJWT(basePayload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(foreign);
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it("валидный access-токен верифицируется (sanity, ассерты не ослаблены)", async () => {
    const token = await createAccessToken(basePayload);
    const payload = await verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("u-1");
  });

  it("валидный refresh-токен верифицируется отдельным секретом (не производным)", async () => {
    const token = await new SignJWT(basePayload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(refreshSecret);
    const payload = await verifyRefreshToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("u-1");
  });

  it("мусорная строка → null (без throw)", async () => {
    await expect(verifyAccessToken("not-a-jwt")).resolves.toBeNull();
    await expect(verifyRefreshToken("")).resolves.toBeNull();
  });
});
