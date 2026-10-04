/**
 * DELETE /api/profile/delete — soft-delete аккаунта пользователя.
 *
 * Тело: { confirmEmail: string }
 *
 * Шаги:
 *   1. Проверяем что confirmEmail совпадает с email текущего пользователя.
 *   2. Помечаем profiles.deleted_at = now() (владелец — user.id из JWT).
 *   3. Очищаем сессионные cookie (cd_session/cd_refresh) — эквивалент signOut
 *      в локальном рантайме без GoTrue.
 *   4. Жёсткое удаление запускается через cron / модерацию позже
 *      (каскадные удаления по FK ON DELETE CASCADE из 0001_init.sql).
 *
 * Безопасность: подтверждение email + владение (user.id из JWT).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clearSessionCookies } from "@/lib/session-cookies";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  // Auth: единый контракт (Bearer + cookie cd_session)
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { confirmEmail } = body as { confirmEmail?: string };

    if (!confirmEmail) {
      return NextResponse.json({ error: "Укажите email для подтверждения" }, { status: 400 });
    }
    if (confirmEmail.toLowerCase() !== (user.email ?? "").toLowerCase()) {
      return NextResponse.json({ error: "Email не совпадает с emailом аккаунта" }, { status: 400 });
    }

    // Шаг 1. Soft delete в profiles.
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", user.id);

    if (profileError) {
      console.error("[profile/delete] profile update error:", profileError.message);
      return NextResponse.json({ error: "Не удалось удалить профиль" }, { status: 500 });
    }

    // Шаг 2. Очищаем сессионные cookie (локальный эквивалент signOut).
    const response = NextResponse.json({
      success: true,
      message: "Аккаунт деактивирован. Полное удаление произойдёт через 30 дней.",
    });
    clearSessionCookies(response);
    return response;
  } catch (error: any) {
    console.error("[profile/delete] exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
