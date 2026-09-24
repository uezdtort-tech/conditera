/**
 * POST /api/profile/email — смена email с подтверждением нового адреса.
 *
 * Тело: { newEmail: string, password: string }
 *
 * Шаги:
 *   1. Проверяем что password валиден (переавторизация).
 *   2. Вызываем supabase.auth.updateUser({ email: newEmail }) — Supabase GoTrue
 *      автоматически отправит verification email на новый адрес.
 *   3. Обновляем profiles.email только после подтверждения (через колбэк
 *      /api/auth/callback) — но Supabase уже делает это сам через auth.users.
 *   4. profiles.email синхронизируем сразу для удобной работы оффлайн-форм.
 *      После отклонения подтверждения email нужно вручную откатить.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/auth";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { user, supabase } = await getSession();
  if (!user || !supabase) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { newEmail, password } = body as { newEmail?: string; password?: string };

    if (!newEmail || !password) {
      return NextResponse.json({ error: "Укажите новый email и текущий пароль" }, { status: 400 });
    }
    if (!EMAIL_RE.test(newEmail)) {
      return NextResponse.json({ error: "Некорректный email" }, { status: 400 });
    }
    if (newEmail.toLowerCase() === (user.email ?? "").toLowerCase()) {
      return NextResponse.json({ error: "Новый email совпадает с текущим" }, { status: 400 });
    }

    // Шаг 1. Проверяем пароль переавторизацией.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email ?? "",
      password,
    });
    if (verifyError) {
      return NextResponse.json({ error: "Пароль неверен" }, { status: 403 });
    }

    // Шаг 2. Просим Supabase обновить email. GoTrue сам отправит письмо
    // подтверждения на новый адрес — пока пользователь не кликнет, старый
    // email остаётся активным.
    const { error: updateError } = await supabase.auth.updateUser({ email: newEmail });
    if (updateError) {
      console.error("[profile/email] update error:", updateError.message);
      return NextResponse.json({ error: "Не удалось сменить email", detail: updateError.message }, { status: 500 });
    }

    // Шаг 3. Обновляем profiles.email (для UI). Auth.users обновится
    // автоматически только после подтверждения пользователем.
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ email: newEmail })
      .eq("id", user.id);

    if (profileError) {
      console.warn("[profile/email] profile update warning:", profileError.message);
    }

    return NextResponse.json({
      success: true,
      message: "Письмо подтверждения отправлено на новый email. Email сменится после подтверждения.",
    });
  } catch (error: any) {
    console.error("[profile/email] exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
