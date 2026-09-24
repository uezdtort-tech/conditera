/**
 * POST /api/auth/2fa/verify — подтвердить 2FA первым кодом и активировать.
 *
 * Логика:
 *   1. Проверка авторизации (через getUserFromRequest)
 *   2. Валидация code (6 цифр)
 *   3. Найти пользователя с two_factor_secret (если нет — 400, вызовите /setup)
 *   4. Если two_factor_enabled=true — вернуть "уже включена"
 *   5. Расшифровать секрет (decryptSecret) и проверить код (verifyTotp)
 *   6. Сгенерировать 10 backup-кодов (generateBackupCodes возвращает codes + hashes)
 *   7. Активировать 2FA: two_factor_enabled=true, two_factor_backup_codes=hashes
 *
 * Auth: AUTHENTICATED
 *
 * Соответствует таблице: profiles (обновление two_factor_enabled + two_factor_backup_codes)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { verifyTotp, decryptSecret, generateBackupCodes } from "@/lib/totp";

export const runtime = "nodejs";

interface VerifyRequestBody {
  code: string;
}

interface VerifyResponse {
  success: boolean;
  backupCodes: string[];
  message: string;
}

/**
 * POST /api/auth/2fa/verify — активировать 2FA через первый код.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const payload = await getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const userId = payload.userId as string;
    const { code } = (await req.json()) as VerifyRequestBody;

    // Валидация code — должно быть ровно 6 цифр
    if (!code || !/^\d{6}$/.test(String(code))) {
      return NextResponse.json(
        { error: "Код должен быть 6 цифр" },
        { status: 400 }
      );
    }

    // Найти пользователя
    const { data: user, error } = await supabaseAdmin
      .from("profiles")
      .select("two_factor_secret, two_factor_enabled")
      .eq("id", userId)
      .maybeSingle();

    if (error || !user) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }

    if (!user.two_factor_secret) {
      return NextResponse.json(
        { error: "Сначала вызовите /api/auth/2fa/setup для инициализации секрета" },
        { status: 400 }
      );
    }

    if (user.two_factor_enabled) {
      return NextResponse.json(
        { error: "2FA уже включена" },
        { status: 400 }
      );
    }

    // Расшифровать секрет и проверить код
    const secret = decryptSecret(user.two_factor_secret);
    if (!verifyTotp(code, secret)) {
      return NextResponse.json(
        { error: "Неверный код. Проверьте время на устройстве." },
        { status: 400 }
      );
    }

    // Сгенерировать backup-коды (10 шт)
    const { codes, hashes } = generateBackupCodes();

    // Активировать 2FA
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({
        two_factor_enabled: true,
        two_factor_backup_codes: hashes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateErr) {
      console.error("[2fa/verify] update error:", updateErr.message);
      return NextResponse.json(
        { error: "Ошибка при активации 2FA", details: updateErr.message },
        { status: 500 }
      );
    }

    const response: VerifyResponse = {
      success: true,
      backupCodes: codes,
      message:
        "2FA включена. Сохраните backup-коды в надёжном месте — они показываются только один раз.",
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("POST /api/auth/2fa/verify error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
