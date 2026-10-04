/**
 * PATCH /api/profile/password — смена пароля.
 *
 * Тело: { oldPassword: string, newPassword: string }
 * newPassword: мин. 8 символов, макс. 128.
 *
 * Локальный рантайм (без Docker/GoTrue): пароль хранится в
 * profiles.password_hash (bcrypt, см. src/lib/auth.ts hashPassword).
 * Проверяем старый пароль bcrypt.compare, новый — bcrypt.hash(10).
 * GoTrue-путь (supabase.auth.updateUser) удалён — он недоступен без
 * Docker-стека и ломал бы единый auth-контракт.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, hashPassword, verifyPassword } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  // Auth: единый контракт (Bearer + cookie cd_session)
  const user = await getUserFromRequest(request);
  if (!user) {
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

    // Шаг 1. Проверяем старый пароль против profiles.password_hash (bcrypt).
    const { data: row, error: fetchError } = await supabaseAdmin
      .from("profiles")
      .select("password_hash")
      .eq("id", user.id)
      .single();

    if (fetchError || !row) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }
    if (!row.password_hash) {
      // Аккаунт создан через внешний провайдер без локального пароля.
      return NextResponse.json(
        { error: "Пароль для аккаунта не задан. Используйте вход через провайдера." },
        { status: 409 }
      );
    }
    const oldOk = await verifyPassword(oldPassword, row.password_hash);
    if (!oldOk) {
      return NextResponse.json({ error: "Старый пароль неверен" }, { status: 403 });
    }

    // Шаг 2. Хешируем и сохраняем новый пароль.
    const newHash = await hashPassword(newPassword);
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ password_hash: newHash })
      .eq("id", user.id);
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
