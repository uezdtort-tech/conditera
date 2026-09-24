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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // Если Supabase не настроен — пропускаем (dev mode без auth)
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
    const protectedPaths = ["/dashboard", "/api/profile", "/api/orders"];
    const isProtectedPath = protectedPaths.some(
      (path) => request.nextUrl.pathname.startsWith(path)
    );

    if (!user && isProtectedPath) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  } catch (e) {
    console.error("[middleware] Supabase session update failed:", (e as Error).message);
  }

  return response;
}
