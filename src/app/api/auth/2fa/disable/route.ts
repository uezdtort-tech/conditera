/**
 * POST /api/auth/2fa/disable — отключить 2FA.
 *
 * Требуется один из:
 *   - TOTP-код из приложения (6 цифр) в поле `code`
 *   - backup-код в поле `backupCode`
 *
 * Логика:
 *   1. Проверка авторизации
 *   2. Найти пользователя с two_factor_secret + two_factor_backup_codes
 *   3. Если two_factor_enabled=false — вернуть "2FA не включена"
 *   4. Проверить либо TOTP-код, либо backup-код
 *   5. Для backup-кода — удалить использованный код из массива
 *   6. Отключить 2FA: two_factor_enabled=false, two_factor_secret=null,
 *      two_factor_backup_codes=[]
 *
 * Auth: AUTHENTICATED
 *
 * Соответствует таблице: profiles (обновление 2FA полей)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { verifyTotp, decryptSecret, verifyBackupCode } from "@/lib/totp";

export const runtime = "nodejs";

interface DisableRequestBody {
  code?: string;
  backupCode?: string;
}

/**
 * POST /api/auth/2fa/disable — отключить 2FA через TOTP или backup-код.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const payload = await getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const userId = payload.userId as string;
    const { code, backupCode } = (await req.json()) as DisableRequestBody;

    if (!code && !backupCode) {
      return NextResponse.json(
        { error: "Укажите TOTP-код (6 цифр) или backup-код" },
        { status: 400 }
      );
    }

    // Найти пользователя
    const { data: user, error } = await supabaseAdmin
      .from("profiles")
      .select(
        `
        two_factor_secret, two_factor_enabled, two_factor_backup_codes
      `
      )
      .eq("id", userId)
      .maybeSingle();

    if (error || !user) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }

    if (!user.two_factor_enabled) {
      return NextResponse.json({ error: "2FA не включена" }, { status: 400 });
    }

    // Проверить либо TOTP, либо backup
    let verified = false;

    if (code) {
      // Проверка TOTP-кода
      if (user.two_factor_secret) {
        const secret = decryptSecret(user.two_factor_secret);
        verified = verifyTotp(code, secret);
      }
    } else if (backupCode) {
      // Проверка backup-кода
      const backupCodes = (user.two_factor_backup_codes as string[]) || [];
      verified = verifyBackupCode(backupCode, backupCodes);

      // Удалить использованный backup-код
      if (verified) {
        const usedHash = backupCodes.find((h) => verifyBackupCode(backupCode, [h]));
        if (usedHash) {
          const remaining = backupCodes.filter((h) => h !== usedHash);
          await supabaseAdmin
            .from("profiles")
            .update({ two_factor_backup_codes: remaining })
            .eq("id", userId);
        }
      }
    }

    if (!verified) {
      return NextResponse.json(
        { error: "Неверный код или backup-код" },
        { status: 400 }
      );
    }

    // Отключить 2FA — очистить все поля
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({
        two_factor_enabled: false,
        two_factor_secret: null,
        two_factor_backup_codes: [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateErr) {
      console.error("[2fa/disable] update error:", updateErr.message);
      return NextResponse.json(
        { error: "Ошибка при отключении 2FA", details: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "2FA отключена. Для повторного включения вызовите /api/auth/2fa/setup.",
    });
  } catch (error: any) {
    console.error("POST /api/auth/2fa/disable error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
