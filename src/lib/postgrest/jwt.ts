/**
 * jwt.ts — проверка Bearer-токенов для PostgREST-шима.
 *
 * Канонические «Supabase-ключи» локального рантайма — это наши собственные
 * HS256-JWT (генерирует scripts/db/setup.mjs):
 *   SUPABASE_SERVICE_ROLE_KEY → payload { role: "service_role", iss: "local" }
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY → payload { role: "anon", iss: "local" }
 * Оба подписаны JWT_SECRET. Дополнительно принимаем app-JWT из /api/auth/login
 * (payload { userId, email, roles }) — из него синтезируется sub для auth.uid().
 */

import { jwtVerify } from "jose";

export type PgrstRole = "anon" | "authenticated" | "service_role";

export interface PgrstClaims {
  role: PgrstRole;
  /** uuid пользователя — попадёт в request.jwt.claims.sub (auth.uid()) */
  sub?: string;
  email?: string;
  raw: Record<string, unknown>;
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET is not set — run npm run db:setup");
  }
  return new TextEncoder().encode(secret);
}

function isPgrstRole(v: unknown): v is PgrstRole {
  return v === "anon" || v === "authenticated" || v === "service_role";
}

/**
 * Разобрать Authorization-заголовок. Нет/битый токен → anon (не ошибка —
 * так ведёт себя PostgREST + GoTrue: невалидный ключ = анонимная роль).
 * Отсутствие JWT_SECRET — фатальная ошибка конфигурации.
 */
export async function resolveClaims(request: Request): Promise<PgrstClaims> {
  const anon: PgrstClaims = { role: "anon", raw: {} };
  const secret = getSecret();

  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return anon;
  const token = header.slice(7).trim();
  if (!token) return anon;

  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    const raw = payload as unknown as Record<string, unknown>;

    const explicitRole = raw.role;
    const hasUser = typeof raw.sub === "string" || typeof raw.userId === "string";
    const role: PgrstRole = isPgrstRole(explicitRole)
      ? explicitRole
      : hasUser
        ? "authenticated"
        : "anon";

    const sub =
      typeof raw.sub === "string" && raw.sub
        ? raw.sub
        : typeof raw.userId === "string"
          ? (raw.userId as string)
          : undefined;

    return {
      role,
      sub,
      email: typeof raw.email === "string" ? raw.email : undefined,
      raw,
    };
  } catch {
    return anon;
  }
}
