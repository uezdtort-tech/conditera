import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Stub mode: просто очищаем cookies
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("sb-access-token");
    response.cookies.delete("sb-refresh-token");
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

    return response;
  } catch (error) {
    console.error("[auth/logout] signOut error:", (error as Error).message);
    return NextResponse.json(
      { error: "Ошибка выхода" },
      { status: 500 }
    );
  }
}
