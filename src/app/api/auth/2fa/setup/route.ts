/**
 * POST /api/auth/2fa/setup — инициализация 2FA для пользователя.
 *
 * Логика:
 *   1. Проверка авторизации (через getUserFromRequest)
 *   2. Найти пользователя в profiles, проверить two_factor_enabled
 *   3. Сгенерировать TOTP секрет через generateTfaSecret()
 *   4. Зашифровать секрет через encryptSecret (использует TFA_ENCRYPTION_KEY)
 *   5. Сохранить в profiles.two_factor_secret (но two_factor_enabled=false)
 *   6. Вернуть секрет + otpauth:// URI + URL QR-кода (через api.qrserver.com)
 *
 * Шаг 2: пользователь сканирует QR в приложении (Google Authenticator)
 * Шаг 3: вводит первый 6-значный код → POST /api/auth/2fa/verify (включает 2FA)
 *
 * Auth: AUTHENTICATED
 *
 * Соответствует таблице: profiles (обновление two_factor_secret)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { generateTfaSecret, buildOtpAuthUri, encryptSecret } from "@/lib/totp";

export const runtime = "nodejs";

interface SetupResponse {
  secret: string;
  otpauthUri: string;
  qrCodeUrl: string;
  message: string;
}

/**
 * POST /api/auth/2fa/setup — инициализировать 2FA.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const payload = await getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const userId = payload.userId as string;

    // Найти пользователя
    const { data: user, error } = await supabaseAdmin
      .from("profiles")
      .select("email, name, two_factor_enabled")
      .eq("id", userId)
      .maybeSingle();

    if (error || !user) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }

    if (user.two_factor_enabled) {
      return NextResponse.json(
        { error: "2FA уже включена. Отключите перед повторной настройкой." },
        { status: 400 }
      );
    }

    // Сгенерировать новый TOTP секрет
    const secret = generateTfaSecret();
    const encrypted = encryptSecret(secret);

    // Сохранить в БД (two_factor_enabled остаётся false до verify)
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ two_factor_secret: encrypted })
      .eq("id", userId);

    if (updateErr) {
      console.error("[2fa/setup] update error:", updateErr.message);
      return NextResponse.json(
        { error: "Ошибка при сохранении секрета", details: updateErr.message },
        { status: 500 }
      );
    }

    // Построить otpauth:// URI для QR-кода
    const accountName = user.email || user.name || "user";
    const otpauthUri = buildOtpAuthUri({
      secret,
      accountName,
    });

    const response: SetupResponse = {
      secret,
      otpauthUri,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(otpauthUri)}`,
      message: "Сканируйте QR-код в приложении аутентификатора, затем введите 6-значный код для подтверждения.",
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("POST /api/auth/2fa/setup error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
