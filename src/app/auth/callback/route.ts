import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * /auth/callback — OAuth callback endpoint.
 *
 * После OAuth входа (Google/Яндекс/VK) Supabase редиректит сюда с ?code=...
 * Здесь обмениваем code на session и редиректим на /dashboard.
 *
 * Документация: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const returnTo = searchParams.get("returnTo") || "/dashboard";

  if (code) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[auth/callback] Supabase env vars not set");
      return NextResponse.redirect(`${origin}/login?error=config`);
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
        },
      },
    });

    try {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error("[auth/callback] exchangeCodeForSession error:", error.message);
        return NextResponse.redirect(`${origin}/login?error=auth_failed`);
      }

      if (!data.user) {
        console.error("[auth/callback] No user after exchange");
        return NextResponse.redirect(`${origin}/login?error=no_user`);
      }

      // Успех — редирект на dashboard (или на returnTo)
      const response = NextResponse.redirect(`${origin}${returnTo}`);

      // Установить auth cookies
      try {
        const session = data.session;
        if (session) {
          response.cookies.set("sb-access-token", session.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 7, // 7 дней
          });
          response.cookies.set("sb-refresh-token", session.refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 7,
          });
        }
      } catch (cookieError) {
        console.warn("[auth/callback] Cookie set error:", (cookieError as Error).message);
      }

      return response;
    } catch (e) {
      console.error("[auth/callback] Unexpected error:", (e as Error).message);
      return NextResponse.redirect(`${origin}/login?error=unknown`);
    }
  }

  // Нет code параметра — редирект на /login
  return NextResponse.redirect(`${origin}/login?error=no_code`);
}
