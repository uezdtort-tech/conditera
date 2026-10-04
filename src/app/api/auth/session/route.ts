import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { verifyAccessToken, type JwtPayload } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session-cookies";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/auth/session — проверка текущей сессии (единый контракт).
 *
 * Источники (по порядку):
 *   1. App-сессия: cookie cd_session (выпускают /api/auth/login и
 *      /api/auth/2fa/login-verify). Возвращаем user + accessToken —
 *      accessToken нужен клиенту для socket.io handshake чата.
 *   2. Supabase GoTrue-сессия (sb-* cookies) — как раньше.
 *
 * Возвращает:
 *   - 200 + { user, accessToken? } если авторизован
 *   - 200 + { user: null } если не авторизован
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  // === 1. App-сессия (cd_session) ===
  const appToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (appToken) {
    const payload = (await verifyAccessToken(appToken)) as JwtPayload | null;
    const userId = payload?.userId || (payload as { sub?: string } | null)?.sub;
    if (payload && userId) {
      // display-name: старые JWT могли не содержать name-claim — догружаем
      // из profiles (источник истины), фолбэк — claim/префикс email
      let displayName =
        (payload as { name?: string }).name ||
        payload.email?.split("@")[0] ||
        "Пользователь";
      try {
        const { data: profileName } = await supabaseAdmin
          .from("profiles")
          .select("name")
          .eq("id", userId)
          .maybeSingle() as { data: { name: string | null } | null; error: unknown };
        if (profileName?.name) displayName = profileName.name;
      } catch {
        // профиль недоступен — используем claim/префикс
      }
      return NextResponse.json({
        user: {
          id: userId,
          email: payload.email || "",
          name: displayName,
          roles: payload.roles || [],
          accountType: payload.accountType || "",
        },
        accessToken: appToken,
        sessionMode: "app",
        expires: null,
      });
    }
  }

  // === 2. Supabase GoTrue-сессия ===
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const response = NextResponse.json({});

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
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    // Загрузить profile + roles
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("user_roles").select("role, is_active").eq("user_id", user.id).eq("is_active", true),
    ]);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: profileRes.data?.name || user.email?.split("@")[0],
        avatar_url: profileRes.data?.avatar_url || user.user_metadata?.avatar_url || null,
        roles: (rolesRes.data || []).map((r) => r.role),
      },
      profile: profileRes.data,
      expires: null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
