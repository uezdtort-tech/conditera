import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { clearSessionCookies, SESSION_COOKIE } from "@/lib/session-cookies";
import { verifyAccessToken } from "@/lib/auth";
import { revokeUserSession } from "@/lib/session-registry";

/**
 * POST /api/auth/logout — выход из системы.
 *
 * Удаляет сессию на сервере и очищает cookies.
 * Возвращает 200 OK + redirect на /.
 *
 * Usage:
 *   fetch('/api/auth/logout', { method: 'POST' });
 */

export async function POST(request: NextRequest): Promise<NextResponse> {
  // При явном Bearer-заголовке используем именно указанный токен,
  // как и getUserFromRequest(); cookie — fallback для браузерного logout.
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const appToken = bearerToken || request.cookies.get(SESSION_COOKIE)?.value;
  if (appToken) {
    const payload = await verifyAccessToken(appToken);
    if (payload?.sid && payload.userId) {
      const revoked = await revokeUserSession(payload.sid, payload.userId, "user_logout");
      if (!revoked) {
        return NextResponse.json({ error: "Не удалось завершить серверную сессию" }, { status: 503 });
      }
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Stub mode: просто очищаем cookies
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("sb-access-token");
    response.cookies.delete("sb-refresh-token");
    // App-сессия (единый контракт: cd_session/cd_refresh)
    clearSessionCookies(response);
    return response;
  }

  // Создаём supabase client с cookies для signOut
  let response = NextResponse.json({ ok: true });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  try {
    await supabase.auth.signOut();

    // Очищаем auth cookies
    response.cookies.delete("sb-access-token");
    response.cookies.delete("sb-refresh-token");
    // App-сессия (единый контракт)
    clearSessionCookies(response);

    return response;
  } catch (error) {
    console.error("[auth/logout] signOut error:", (error as Error).message);
    return NextResponse.json(
      { error: "Ошибка выхода" },
      { status: 500 }
    );
  }
}
