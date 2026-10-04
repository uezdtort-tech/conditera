/**
 * POST /api/profile/email — смена email с подтверждением пароля.
 *
 * Тело: { newEmail: string, password: string }
 *
 * Локальный рантайм (без Docker/GoTrue/SMTP): пароль проверяется против
 * profiles.password_hash (bcrypt), email обновляется в profiles сразу.
 * Письмо-подтверждение не отправляется (SMTP не настроен) — сообщение
 * честно об этом информирует. Уникальность email гарантируется проверкой
 * перед обновлением (в БД — UNIQUE constraint как страховка).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, verifyPassword } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Auth: единый контракт (Bearer + cookie cd_session)
  const user = await getUserFromRequest(request);
  if (!user) {
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

    // Шаг 1. Проверяем пароль против profiles.password_hash (bcrypt).
    const { data: row, error: fetchError } = await supabaseAdmin
      .from("profiles")
      .select("email, password_hash")
      .eq("id", user.id)
      .single();

    if (fetchError || !row) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }
    if (!row.password_hash) {
      return NextResponse.json(
        { error: "Пароль для аккаунта не задан. Используйте вход через провайдера." },
        { status: 409 }
      );
    }
    const passwordOk = await verifyPassword(password, row.password_hash);
    if (!passwordOk) {
      return NextResponse.json({ error: "Пароль неверен" }, { status: 403 });
    }

    // Шаг 2. Проверяем уникальность нового email.
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", newEmail.toLowerCase())
      .neq("id", user.id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "Этот email уже используется другим аккаунтом" }, { status: 409 });
    }

    // Шаг 3. Обновляем profiles.email. В локальном рантайме (без SMTP)
    // письмо-подтверждение не отправляется — смена применяется сразу.
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ email: newEmail.toLowerCase() })
      .eq("id", user.id);

    if (profileError) {
      console.error("[profile/email] profile update error:", profileError.message);
      return NextResponse.json({ error: "Не удалось сменить email", detail: profileError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Email обновлён. Подтверждающее письмо не отправляется в локальном режиме (SMTP не настроен).",
    });
  } catch (error: any) {
    console.error("[profile/email] exception:", error?.message);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
