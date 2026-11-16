import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { verifyAccessToken, type JwtPayload } from "@/lib/auth";
import {
  SESSION_COOKIE,
  clearSessionCookies,
} from "@/lib/session-cookies";
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
 * ZV33-8d FIX A (D1): заблокированный пользователь (profiles.is_blocked)
 * больше НЕ получает 200 + свежий accessToken — 403 {"error":"ACCOUNT_BLOCKED"}
 * + сессионные cookie очищаются (раньше блокировка гоняла сессию до истечения
 * JWT; login уже отказывал, а session/refresh продолжали поддерживать).
 *
 * Возвращает:
 *   - 200 + { user, accessToken? } если авторизован
 *   - 200 + { user: null } если не авторизован
 *   - 403 { error: "ACCOUNT_BLOCKED" } + cookie очищены, если заблокирован
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  // === 1. App-сессия (cd_session) ===
  const appToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (appToken) {
    const payload = (await verifyAccessToken(appToken)) as JwtPayload | null;
    const userId = payload?.userId || (payload as { sub?: string } | null)?.sub;
    if (payload && userId) {
      // display-name + блокировка: профиль — источник истины (ZV33-8d FIX A).
      // is_blocked нужен ДО выпуска/подтверждения сессии: заблокированный
      // пользователь не должен получать 200 + accessToken.
      let displayName =
        (payload as { name?: string }).name ||
        payload.email?.split("@")[0] ||
        "Пользователь";
      try {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("name, is_blocked")
          .eq("id", userId)
          .maybeSingle() as {
            data: { name: string | null; is_blocked: boolean | null } | null;
            error: unknown;
          };
        if (profile?.name) displayName = profile.name;
        if (profile?.is_blocked) {
          // D1: отказ + очистка сессионных cookie (cd_session/cd_refresh) —
          // без выпуска/продления токенов.
          const blockedResponse = NextResponse.json(
            { error: "ACCOUNT_BLOCKED", message: "Аккаунт заблокирован" },
            { status: 403 }
          );
          return clearSessionCookies(blockedResponse);
        }
      } catch (dbErr) {
        // профиль недоступен — используем claim/префикс (fail-open на имя;
        // блокировку при ошибке БД не проверяем — тот же fail-open, что в
        // getUserFromRequest blocked-check для GET: маршрут — чтение (GET),
        // R3 разрешает fail-open только для чтения; мутирующие запросы этого
        // пользователя будут отклонены fail-closed проверкой в auth.ts).
        console.warn(
          "[auth/session] profile lookup failed (GET fail-open):",
          dbErr instanceof Error ? dbErr.message : String(dbErr)
        );
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

    // ZV33-8d FIX A: заблокированный через GoTrue-сессию — тот же контракт 403
    if (profileRes.data?.is_blocked) {
      const blockedResponse = NextResponse.json(
        { error: "ACCOUNT_BLOCKED", message: "Аккаунт заблокирован" },
        { status: 403 }
      );
      return clearSessionCookies(blockedResponse);
    }

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
