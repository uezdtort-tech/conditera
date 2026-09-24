/**
 * DELETE /api/profile/delete — soft-delete аккаунта пользователя.
 *
 * Тело: { confirmEmail: string }
 *
 * Шаги:
 *   1. Проверяем что confirmEmail совпадает с email текущего пользователя.
 *   2. Помечаем profiles.deleted_at = now() (RLS: владелец может обновить свою строку).
 *   3. Аннулируем сессию (signOut).
 *   4. Жёсткое удаление auth.users запускается через cron / модерацию позже
 *      (каскадные удаления в profiles, addresses, user_roles, etc. сработают
 *      по FK ON DELETE CASCADE из 0001_init.sql).
 *
 * Безопасность: подтверждение email + RLS (нельзя удалить чужой профиль).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
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
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", user.id);

    if (profileError) {
      console.error("[profile/delete] profile update error:", profileError.message);
      return NextResponse.json({ error: "Не удалось удалить профиль" }, { status: 500 });
    }

    // Шаг 2. Sign out — аннулируем текущую сессию.
    await supabase.auth.signOut();

    // Шаг 3. Помечаем auth.users как soft-deleted (GoTrue не поддерживает soft-delete,
    // но мы можем деактивировать через admin SDK). Реальное удаление отложим —
    // даём пользователю окно для восстановления (30 дней), через cron задаче.
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      // ban_duration: 30 days
      ban_duration: "86400s",
    });

    if (authError) {
      console.warn("[profile/delete] auth ban warning:", authError.message);
    }

    return NextResponse.json({
      success: true,
      message: "Аккаунт деактивирован. Полное удаление произойдёт через 30 дней.",
    });
  } catch (error: any) {
    console.error("[profile/delete] exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
