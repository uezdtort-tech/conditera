/**
 * PATCH /api/profile/password — смена пароля.
 *
 * Тело: { oldPassword: string, newPassword: string }
 * newPassword: мин. 8 символов, макс. 128.
 *
 * Под капотом: supabase.auth.updateUser({ password }) — Supabase GoTrue
 * сам проверяет текущий пароль (требует свежей сессии) и хеширует новый
 * через Argon2id. Мы НЕ используем кастомный Argon2 в profiles.password_hash
 * здесь — пусть GoTrue будет source-of-truth для паролей.
 *
 * После смены пароля все сессии пользователя аннулируются (Supabase делает
 * это автоматически через refresh token revocation).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { oldPassword, newPassword } = body as { oldPassword?: string; newPassword?: string };

    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: "Укажите старый и новый пароль" }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Новый пароль должен быть не менее 8 символов" }, { status: 400 });
    }
    if (newPassword.length > 128) {
      return NextResponse.json({ error: "Новый пароль слишком длинный (макс. 128 символов)" }, { status: 400 });
    }
    if (oldPassword === newPassword) {
      return NextResponse.json({ error: "Новый пароль должен отличаться от старого" }, { status: 400 });
    }

    // Шаг 1. Проверяем старый пароль, переавторизовываясь.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email ?? "",
      password: oldPassword,
    });
    if (verifyError) {
      return NextResponse.json({ error: "Старый пароль неверен" }, { status: 403 });
    }

    // Шаг 2. Меняем пароль.
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      console.error("[profile/password] update error:", updateError.message);
      return NextResponse.json({ error: "Не удалось сменить пароль", detail: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[profile/password] exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
