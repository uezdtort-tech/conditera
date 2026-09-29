/**
 * POST /api/auth/2fa/login-verify — второй шаг логина с 2FA.
 *
 * Flow:
 *   1. POST /api/auth/login → пароль верный, two_factor_enabled=true
 *      → возвращает { tfaRequired: true, tfaTempToken }
 *   2. POST /api/auth/2fa/login-verify { tfaTempToken, code | backupCode }
 *      → проверяет TOTP-код или backup-код
 *      → в случае успеха выдаёт access/refresh токены
 *
 * tfaTempToken — короткоживущий (5 минут) JWT с claim tfa_pending=true.
 *
 * Поддерживаются:
 *   - 6-значный TOTP-код из приложения-аутентификатора
 *   - 8-символьный backup-код XXXX-XXXX (одноразовый, расходуется)
 *
 * Auth: PUBLIC (использует tfaTempToken вместо обычной авторизации)
 *
 * Соответствует таблице: profiles (поиск по id + two_factor_secret + two_factor_backup_codes)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  verifyTfaLoginToken,
  createAccessToken,
  createRefreshToken,
} from "@/lib/auth";
import { safeJsonBody } from "@/lib/http-helpers";
import {
  verifyTotp,
  decryptSecret,
  verifyBackupCode,
  hashBackupCode,
} from "@/lib/totp";

export const runtime = "nodejs";

interface LoginVerifyRequestBody {
  tfaTempToken: string;
  code?: string;
  backupCode?: string;
}

interface SanitizedUser {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  roles: string[];
  accountType: string;
  city: string | null;
  bonusBalance: number;
  loyaltyLevel: string;
}

/**
 * Получить роли пользователя из user_roles.
 */
async function getUserRoles(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("is_active", true);
  return (data || []).map((r: any) => r.role as string);
}

/**
 * POST /api/auth/2fa/login-verify — второй шаг логина с 2FA.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { data: body, error: parseErr } = await safeJsonBody<LoginVerifyRequestBody>(request);
    if (parseErr || !body) {
      return NextResponse.json(
        { error: "Невалидный JSON в теле запроса" },
        { status: 400 }
      );
    }
    const { tfaTempToken, code, backupCode } = body;

    if (!tfaTempToken || typeof tfaTempToken !== "string") {
      return NextResponse.json(
        { error: "Не передан tfaTempToken" },
        { status: 400 }
      );
    }

    if (!code && !backupCode) {
      return NextResponse.json(
        { error: "Передайте code (6 цифр TOTP) или backupCode (XXXX-XXXX)" },
        { status: 400 }
      );
    }

    // 1. Валидировать временный токен (5 минут TTL)
    const tempPayload = await verifyTfaLoginToken(tfaTempToken);
    if (!tempPayload || !tempPayload.userId) {
      return NextResponse.json(
        {
          error:
            "Недействительный или истёкший временный токен. Начните логин заново через POST /api/auth/login.",
        },
        { status: 401 }
      );
    }

    // 2. Загрузить пользователя
    const { data: user, error } = await supabaseAdmin
      .from("profiles")
      .select(
        `
        id, email, name, phone, account_type, city, bonus_balance,
        loyalty_level, is_blocked, two_factor_enabled, two_factor_secret,
        two_factor_backup_codes
      `
      )
      .eq("id", tempPayload.userId as string)
      .maybeSingle();

    if (error || !user) {
      return NextResponse.json(
        { error: "Пользователь не найден" },
        { status: 404 }
      );
    }

    if (!user.two_factor_enabled || !user.two_factor_secret) {
      return NextResponse.json(
        { error: "2FA не настроена для этого пользователя" },
        { status: 400 }
      );
    }

    if (user.is_blocked) {
      return NextResponse.json(
        { error: "Аккаунт заблокирован" },
        { status: 403 }
      );
    }

    // 3. Проверить код (TOTP или backup)
    let verified = false;
    let usedBackupCode: string | null = null;

    if (code) {
      // 6-значный TOTP-код
      if (!/^\d{6}$/.test(String(code))) {
        return NextResponse.json(
          { error: "Код должен быть 6 цифр" },
          { status: 400 }
        );
      }
      try {
        const secret = decryptSecret(user.two_factor_secret);
        verified = verifyTotp(code, secret);
      } catch (e: any) {
        console.error("[2fa/login-verify] decrypt error:", e?.message);
        return NextResponse.json(
          { error: "Ошибка расшифровки секрета. Обратитесь к администратору." },
          { status: 500 }
        );
      }
    } else if (backupCode) {
      // 8-символьный backup-код XXXX-XXXX
      const normalized = backupCode.toUpperCase().trim();
      if (!/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(normalized)) {
        return NextResponse.json(
          { error: "Неверный формат backup-кода (XXXX-XXXX)" },
          { status: 400 }
        );
      }
      const hashes = (user.two_factor_backup_codes as string[]) || [];
      if (verifyBackupCode(normalized, hashes)) {
        verified = true;
        usedBackupCode = normalized;
      }
    }

    if (!verified) {
      return NextResponse.json(
        { error: "Неверный код. Проверьте время на устройстве или используйте backup-код." },
        { status: 401 }
      );
    }

    // 4. Если использован backup-код — атомарно списать его (RPC 0039).
    // pay4: прежний read-filter-write пускал два параллельных логина с одним
    // кодом (оба получали JWT). RPC с guard'ом в WHERE — выигрывает ровно один.
    let remainingBackupCodes = (user.two_factor_backup_codes as string[]) || [];
    if (usedBackupCode) {
      const usedHash = hashBackupCode(usedBackupCode);
      const { data: consumed, error: consumeErr } = await supabaseAdmin
        .rpc("consume_tfa_backup_code_v2", {
          p_user_id: user.id,
          p_code_hash: usedHash,
        })
        .single() as { data: unknown; error: (Error & { code?: string }) | null };

      if (consumeErr && consumeErr.code === "PGRST202") {
        // FAIL-CLOSED: RPC отсутствует (миграция 0039 не применена) —
        // НЕ выдаём токены небезопасным путём
        return NextResponse.json(
          {
            error:
              "2FA временно недоступна: не применена миграция БД (0039). Используйте TOTP-код или обратитесь в поддержку.",
          },
          { status: 503 }
        );
      }
      if (consumeErr) {
        console.error("[2fa/login-verify] backup-code consume failed:", consumeErr.message);
        return NextResponse.json(
          { error: "Ошибка проверки backup-кода. Попробуйте ещё раз." },
          { status: 500 }
        );
      }
      // PostgREST для scalar-RPC возвращает булево напрямую; поддерживаем
      // и обёрнутый в объект вид на случай адаптеров
      const consumedOk =
        typeof consumed === "boolean"
          ? consumed
          : Boolean((consumed as Record<string, unknown> | null)?.consume_tfa_backup_code_v2);
      if (!consumedOk) {
        // Код уже списан конкурентным логином
        return NextResponse.json(
          { error: "Backup-код недействителен или уже использован." },
          { status: 401 }
        );
      }
      remainingBackupCodes = remainingBackupCodes.filter((h) => h !== usedHash);

      if (remainingBackupCodes.length <= 2) {
        console.warn(`⚠️ Пользователь ${user.email} имеет только ${remainingBackupCodes.length} backup-кодов`);
      }
    }

    // 5. Выдать access/refresh токены
    const roles = await getUserRoles(user.id);

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      roles,
      accountType: user.account_type,
    };

    const accessToken = await createAccessToken(tokenPayload);
    const refreshToken = await createRefreshToken({ userId: user.id });

    // Sanitize response
    const safeUser: SanitizedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      roles,
      accountType: user.account_type,
      city: user.city,
      bonusBalance: Number(user.bonus_balance) || 0,
      loyaltyLevel: user.loyalty_level,
    };

    return NextResponse.json({
      user: safeUser,
      accessToken,
      refreshToken,
      ...(usedBackupCode && {
        warning: `Backup-код ${usedBackupCode} использован и удалён. Осталось backup-кодов: ${remainingBackupCodes.length}`,
      }),
    });
  } catch (error: any) {
    console.error("POST /api/auth/2fa/login-verify error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: error?.message },
      { status: 500 }
    );
  }
}
