/**
 * session-cookies.ts — единый контракт browser-сессии.
 *
 * Консолидация auth-контрактов (раунд «один поток»):
 *   • Раньше: браузер ходил либо с cookie-сессией Supabase (sb-*-auth-token,
 *     которую понимали только ~13 Supabase-роутов), либо с Bearer JWT,
 *     который клиент должен был прикреплять вручную (163 роута через
 *     getUserFromRequest). После нормального входа часть API получала 401.
 *   • Теперь: /api/auth/login (и 2FA verify, register) выпускают app-JWT
 *     И в тело, И в httpOnly cookie. getUserFromRequest() понимает оба
 *     канала (cookie cd_session → Authorization: Bearer → cookie Supabase).
 *     Один контракт: сессия в cookie — канонична для браузера,
 *     Bearer — для программных клиентов (e2e, интеграции).
 *
 * Cookies:
 *   cd_session — access JWT (HS256), 7d, httpOnly, SameSite=Lax
 *   cd_refresh — refresh JWT, 30d, httpOnly, SameSite=Lax (используется
 *                /api/auth/refresh для продления без повторного логина)
 */
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "cd_session";
export const REFRESH_COOKIE = "cd_refresh";

const isProd = process.env.NODE_ENV === "production";

const baseOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProd,
  path: "/",
};

/** Установить обе сессионные cookie на ответ. */
export function setSessionCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken?: string | null }
): NextResponse {
  response.cookies.set(SESSION_COOKIE, tokens.accessToken, {
    ...baseOptions,
    maxAge: 60 * 60 * 24 * 7, // 7d — синхронно с JWT_EXPIRES_IN
  });
  if (tokens.refreshToken) {
    response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
      ...baseOptions,
      maxAge: 60 * 60 * 24 * 30, // 30d
    });
  }
  return response;
}

/** Очистить сессионные cookie (logout). */
export function clearSessionCookies(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, "", { ...baseOptions, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...baseOptions, maxAge: 0 });
  return response;
}
