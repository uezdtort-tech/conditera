/**
 * POST /api/auth/refresh — обновить access token по refresh token.
 *
 * Логика:
 *   1. Получить refreshToken из тела запроса
 *   2. verifyRefreshToken — проверка подписи и срока действия
 *   3. Найти пользователя по payload.userId в profiles
 *   4. Проверить is_blocked (если заблокирован — отказать)
 *   5. Получить роли пользователя из user_roles
 *   6. Создать новый access token через createAccessToken
 *
 * Auth: PUBLIC endpoint (используется для обновления сессии)
 *
 * Соответствует таблицам: profiles, user_roles
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyRefreshToken, createAccessToken } from "@/lib/auth";
import { safeJsonBody } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RefreshRequestBody {
  refreshToken: string;
}

/**
 * POST /api/auth/refresh — обновить access token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { data: refreshBody, error: parseErr } = await safeJsonBody<RefreshRequestBody>(request);
    if (parseErr || !refreshBody) {
      return NextResponse.json(
        { error: "Невалидный JSON в теле запроса" },
        { status: 400 }
      );
    }
    const { refreshToken } = refreshBody;

    if (!refreshToken || typeof refreshToken !== "string") {
      return NextResponse.json(
        { error: "Refresh token обязателен" },
        { status: 400 }
      );
    }

    // 1. Verify refresh token signature + expiration
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload) {
      return NextResponse.json(
        { error: "Недействительный refresh token" },
        { status: 401 }
      );
    }

    // 2. Найти пользователя
    const { data: user, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, is_blocked, account_type")
      .eq("id", payload.userId)
      .maybeSingle();

    if (error || !user) {
      return NextResponse.json(
        { error: "Пользователь не найден" },
        { status: 403 }
      );
    }

    if (user.is_blocked) {
      return NextResponse.json(
        { error: "Пользователь заблокирован" },
        { status: 403 }
      );
    }

    // 3. Получить активные роли пользователя
    const { data: rolesData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("is_active", true);
    const roles = (rolesData || []).map((r: any) => r.role as string);

    // 4. Создать новый access token
    const newAccessToken = await createAccessToken({
      userId: user.id,
      email: user.email,
      roles,
      accountType: user.account_type,
    });

    return NextResponse.json({ accessToken: newAccessToken });
  } catch (error: any) {
    console.error("Refresh error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: error?.message },
      { status: 500 }
    );
  }
}
