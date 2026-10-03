/**
 * middleware.ts — обновление Supabase сессии при каждом запросе.
 *
 * Next.js middleware запускается до всех route handlers.
 * Здесь мы refresh access token если он истёк, и сохраняем в cookies.
 *
 * Документация: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveSupabaseServerUrl, SUPABASE_COOKIE_NAME } from "./url";
import { SESSION_COOKIE } from "@/lib/session-cookies";

const supabaseUrl = resolveSupabaseServerUrl();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // Если Supabase не настроен — пропускаем (dev mode без auth)
  if (!supabaseAnonKey) {
    return response;
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookieOptions: { name: SUPABASE_COOKIE_NAME },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    // Проверяем сессию (это refresh'ит токен автоматически)
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Защищённые маршруты — редирект на /login если не авторизован
    // Bearer-клиенты (программный контракт) не редиректим: роут сам вернёт
    // 401 JSON через getUserFromRequest; redirect здесь ломал curl/API-клиентов.
    // Единый auth-контракт: наличие app-сессии в httpOnly cookie cd_session
    // (кладут /api/auth/login|register-2fa) тоже считается авторизацией —
    // иначе в local-runtime (GoTrue = 501-заглушка) /dashboard всегда
    // редиректил на /login даже с валидной cookie-сессией.
    const hasBearer =
      request.headers.get("authorization")?.toLowerCase().startsWith("bearer ") ?? false;
    const hasAppSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
    const protectedPaths = ["/dashboard", "/api/profile", "/api/orders"];
    const isProtectedPath = protectedPaths.some(
      (path) => request.nextUrl.pathname.startsWith(path)
    );

    if (!user && !hasBearer && !hasAppSession && isProtectedPath) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  } catch (e) {
    console.error("[middleware] Supabase session update failed:", (e as Error).message);
  }

  return response;
}
