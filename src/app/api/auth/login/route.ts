/**
 * POST /api/auth/login — вход по email и паролю.
 *
 * Логика:
 *   1. Anti-fraud: не более 20 попыток логина в час с IP (защита от brute-force)
 *   2. Валидация: email и password обязательны
 *   3. Найти пользователя в profiles по email (lowercase)
 *   4. Проверка is_blocked — вернуть причину блокировки
 *   5. verifyPassword (Argon2id) — проверить пароль
 *   6. 2FA GATE: если tfa_enabled и tfa_secret — НЕ выдаём access/refresh токены,
 *      возвращаем tfaRequired: true + tfaTempToken для второго шага (POST /api/auth/2fa/login-verify)
 *   7. Без 2FA — выдать access + refresh JWT токены
 *   8. Sanitize response (без passwordHash, tfaSecret, lastLoginIp)
 *
 * Anti-fraud: 20 попыток в час с IP (через @/lib/anti-fraud)
 *
 * Соответствует таблице: profiles (поиск по email + is_blocked + tfa_enabled + tfa_secret)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  verifyPassword,
  createAccessToken,
  createRefreshToken,
  createTfaLoginToken,
} from "@/lib/auth";
import { safeJsonBody } from "@/lib/http-helpers";
import { setSessionCookies } from "@/lib/session-cookies";
import { findDevFallbackUser } from "@/lib/dev-auth";
import { isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const FRAUD_ACTION = "login";
const MAX_LOGIN_ATTEMPTS_PER_HOUR = 20;

interface LoginRequestBody {
  email: string;
  password: string;
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
  isVerified: boolean;
}

/**
 * Получить роли пользователя из таблицы user_roles.
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
 * POST /api/auth/login — войти по email и паролю.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Anti-fraud: не более 20 попыток логина в час с IP
    const { checkFraudLimit } = await import("@/lib/anti-fraud");
    const fraudCheck = await checkFraudLimit(request, FRAUD_ACTION);
    if (!fraudCheck.allowed) {
      const retryAfter = Math.ceil((fraudCheck.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: fraudCheck.reason, retryAfter },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        }
      );
    }

    const { data: body, error: parseErr } = await safeJsonBody<LoginRequestBody>(request);
    if (parseErr || !body) {
      return NextResponse.json(
        { error: "Невалидный JSON в теле запроса" },
        { status: 400 }
      );
    }
    const { email, password } = body;

    // 2. Валидация
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email и пароль обязательны" },
        { status: 400 }
      );
    }
    if (typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { error: "Email и пароль должны быть строками" },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase();

    // 3. Найти пользователя в profiles
    const { data: user, error } = await supabaseAdmin
      .from("profiles")
      .select(
        `
        id, email, name, phone, password_hash, is_blocked, blocked_reason,
        account_type, city, bonus_balance, loyalty_level, is_verified,
        two_factor_enabled, two_factor_secret, last_login_at
      `
      )
      .eq("email", emailLower)
      .maybeSingle();

    // 3.a DEV-FALLBACK: Supabase не настроен (isAdminConfigured() === false)
    // — например, локальная dev-среда/preview без запущенного стека.
    // Аутентифицируем по demo-списку и выпускаем НАСТОЯЩИЙ JWT (тот же
    // механизм, тот же секрет, те же роли). В production с настроенным
    // Supabase эта ветка недостижима (см. src/lib/dev-auth.ts).
    if ((error || !user) && !isAdminConfigured()) {
      const devUser = findDevFallbackUser(emailLower, password);
      if (devUser) {
        console.warn(
          `[login] DEV-FALLBACK: вход ${devUser.email} без Supabase (dev-сессия).`
        );
        const devPayload = {
          userId: devUser.id,
          email: devUser.email,
          roles: devUser.roles,
          accountType: devUser.accountType,
        };
        const devAccessToken = await createAccessToken(devPayload);
        const devRefreshToken = await createRefreshToken({ userId: devUser.id });
        const devSafeUser = {
          id: devUser.id,
          email: devUser.email,
          name: devUser.name,
          phone: devUser.phone,
          roles: devUser.roles,
          accountType: devUser.accountType,
          city: devUser.city,
          bonusBalance: devUser.bonusBalance,
          loyaltyLevel: devUser.loyaltyLevel,
          isVerified: devUser.isVerified,
        };
        const devResponse = NextResponse.json({
          user: devSafeUser,
          accessToken: devAccessToken,
          refreshToken: devRefreshToken,
          sessionMode: "dev-fallback",
        });
        // Cookie-сессия — каноничный канал для браузера (см. session-cookies.ts)
        return setSessionCookies(devResponse, {
          accessToken: devAccessToken,
          refreshToken: devRefreshToken,
        });
      }
    }

    if (error || !user) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 }
      );
    }

    // 4. Проверка блокировки
    if (user.is_blocked) {
      return NextResponse.json(
        { error: `Аккаунт заблокирован: ${user.blocked_reason || "причина не указана"}` },
        { status: 403 }
      );
    }

    // 5. verifyPassword (Argon2id).
    // Переходный период (двойная auth-система): у пользователей, зарегистрированных
    // через SupabaseAuthModal (GoTrue signInWithSignUp), password_hash в profiles нет —
    // для них доверяем GoTrue signInWithPassword как источнику истины по паролю.
    let goTrueAuthed = false;
    let isValid = false;
    if (user.password_hash) {
      isValid = await verifyPassword(password, user.password_hash);
    } else {
      try {
        const precheck = await getSupabaseServer();
        const { error: gtPreErr } = await precheck.auth.signInWithPassword({
          email: emailLower,
          password,
        });
        if (!gtPreErr) {
          isValid = true;
          goTrueAuthed = true;
        }
      } catch {
        // GoTrue недоступен — считаем пароль неверным (как и раньше)
      }
    }
    if (!isValid) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 }
      );
    }

    // Получить роли пользователя
    const userRoles = await getUserRoles(user.id);

    // 6. 2FA GATE
    if (user.two_factor_enabled && user.two_factor_secret) {
      const tfaTempToken = await createTfaLoginToken({
        userId: user.id,
        email: user.email,
        roles: userRoles,
        accountType: user.account_type,
      });

      return NextResponse.json({
        tfaRequired: true,
        tfaTempToken,
        message: "Введите код из приложения-аутентификатора",
      });
    }

    // 7. Без 2FA — выдать токены

    // 7.a GoTrue-сессия (best effort): Supabase SSR API (/api/confectioner/*, дашборды)
    // читают sb-* cookies через getSession(). Пароли GoTrue и profiles.password_hash
    // совпадают, т.к. register создаёт пользователя в обоих хранилищах.
    // Для GoTrue-only пользователей сессия уже получена на шаге 5 (goTrueAuthed).
    if (!goTrueAuthed) {
      try {
        const ssr = await getSupabaseServer();
        const { error: gtErr } = await ssr.auth.signInWithPassword({
          email: emailLower,
          password,
        });
        if (gtErr) {
          // Email не подтверждён в GoTrue (register делает email_confirm: false для prod-флоу
          // письма-подтверждения). Пароль уже проверен Argon2id по profiles выше — владелец
          // учётных данных подтверждён, поэтому подтверждаем email через admin API и повторяем.
          if (gtErr.message === "Email not confirmed") {
            const { error: upErr } = await supabaseAdmin.auth.admin
              .updateUserById(user.id, { email_confirm: true });
            if (!upErr) {
              await ssr.auth.signInWithPassword({ email: emailLower, password });
            } else {
              console.warn("[login] GoTrue email confirm update failed:", upErr.message);
            }
          } else {
            console.warn(
              "[login] GoTrue signInWithPassword failed (legacy-only user?):",
              gtErr.message,
            );
          }
        }
      } catch (gtEx) {
        console.warn(
          "[login] GoTrue session skipped:",
          gtEx instanceof Error ? gtEx.message : gtEx,
        );
      }
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      // name — для /api/auth/session (приветствие в дашборде), чтобы не
      // фолбэчиться на email-префикс до загрузки профиля
      name: user.name || user.email?.split("@")[0] || "Пользователь",
      roles: userRoles,
      accountType: user.account_type,
    };

    const accessToken = await createAccessToken(tokenPayload);
    const refreshToken = await createRefreshToken({ userId: user.id });

    // Обновить last_login_at (non-blocking)
    supabaseAdmin
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id)
      .then(() => { /* fire-and-forget */ });

    // 8. Sanitize response
    const safeUser: SanitizedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      roles: userRoles,
      accountType: user.account_type,
      city: user.city,
      bonusBalance: Number(user.bonus_balance) || 0,
      loyaltyLevel: user.loyalty_level,
      isVerified: Boolean(user.is_verified),
    };

    const response = NextResponse.json({
      user: safeUser,
      accessToken,
      refreshToken,
    });
    // Cookie-сессия — каноничный канал для браузера: после этого все API,
    // читающие getUserFromRequest(), работают без ручного Bearer-заголовка.
    return setSessionCookies(response, { accessToken, refreshToken });
  } catch (error: any) {
    console.error("Login error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: error?.message },
      { status: 500 }
    );
  }
}
