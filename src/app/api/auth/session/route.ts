import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * GET /api/auth/session — проверка текущей сессии.
 *
 * Возвращает:
 *   - 200 + { user, profile, roles } если авторизован
 *   - 401 если не авторизован
 *
 * Используется в middleware и для проверки на клиенте.
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
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
