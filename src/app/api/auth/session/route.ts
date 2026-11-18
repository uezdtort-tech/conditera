import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getUserFromRequest } from "@/lib/auth";
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
  const bearerToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const appToken = request.cookies.get(SESSION_COOKIE)?.value || bearerToken;
  if (appToken) {
    // Не доверяем claims токена для ролей/профиля. Повторно проверяем
    // актуальное состояние аккаунта через общий fail-closed auth guard.
    const appUser = await getUserFromRequest(request);
    if (!appUser) {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    return NextResponse.json({
      user: {
        id: appUser.id,
        email: appUser.email,
        name: appUser.name,
        roles: appUser.roles,
        accountType: appUser.accountType,
      },
      accessToken: appToken,
      sessionMode: "app",
      expires: null,
    });
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
      supabase.from("profiles").select("id, email, name, avatar_url, is_blocked, deleted_at, account_type").eq("id", user.id).single(),
      supabase.from("user_roles").select("role, is_active").eq("user_id", user.id).eq("is_active", true),
    ]);

    // GoTrue-only/legacy session: профиль и роли тоже проверяются fail-closed.
    if (
      profileRes.error ||
      !profileRes.data ||
      profileRes.data.is_blocked === true ||
      Boolean(profileRes.data.deleted_at) ||
      rolesRes.error
    ) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: profileRes.data.email || user.email,
        name: profileRes.data.name || user.email?.split("@")[0],
        avatar_url: profileRes.data.avatar_url || user.user_metadata?.avatar_url || null,
        roles: (rolesRes.data || []).map((r) => r.role),
        accountType: profileRes.data.account_type || "individual",
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
