/**
 * POST /api/auth/register — регистрация нового пользователя.
 *
 * Логика (15 шагов):
 *   1. Anti-fraud: не более 3 регистраций в час с IP (защита от mass-register)
 *   2. Валидация: email, password (≥8), name, phone — обязательные
 *   3. Проверка уникальности email в profiles
 *   4. Проверка уникальности телефона в profiles (по полю phone)
 *   5. Проверка чёрного списка (email + phone) в blacklist таблице
 *   6. Проверка организации через DaData (если accountType=legal и есть ИНН)
 *   7. Создание пользователя в Supabase Auth (admin.createUser с паролем)
 *   8. Создание записи в profiles (с hash пароля, ролями, accountType, loyaltyLevel)
 *   9. Создание referral записи (реферальный код из имени + id)
 *  10. Генерация access + refresh JWT токенов (через @/lib/auth)
 *  11. Sanitize response (без passwordHash, tfaSecret, lastLoginIp)
 *  12. Яндекс Метрика: trackEventServer('user_registered')
 *  13. Telegram уведомление о новом пользователе (non-blocking)
 *  14. Email: welcome письмо (non-blocking)
 *
 * Anti-fraud: 3 регистрации в час с IP (через @/lib/anti-fraud)
 *
 * Соответствует таблицам:
 *  - profiles (создание записи пользователя)
 *  - blacklist (проверка чёрного списка email/phone)
 *  - referrals (создание реферального кода)
 *  - auth.users (создание в Supabase Auth)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashPassword, createAccessToken, createRefreshToken } from "@/lib/auth";
import { safeJsonBody } from "@/lib/http-helpers";

export const runtime = "nodejs";

const MIN_PASSWORD_LENGTH = 8;
const FRAUD_ACTION = "register";

interface RegisterRequestBody {
  email: string;
  password: string;
  name: string;
  phone: string;
  role?: string;
  accountType?: "individual" | "legal";
  legalInfo?: {
    inn?: string;
    ogrn?: string;
    companyName?: string;
  } | null;
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
 * POST /api/auth/register — зарегистрировать нового пользователя.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Anti-fraud: не более 3 регистраций в час с IP
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

    const { data: body, error: parseErr } = await safeJsonBody<RegisterRequestBody>(request);
    if (parseErr || !body) {
      return NextResponse.json(
        { error: "Невалидный JSON в теле запроса" },
        { status: 400 }
      );
    }
    const {
      email,
      password,
      name,
      phone,
      role = "CUSTOMER",
      accountType = "individual",
      legalInfo,
    } = body;

    // 1.5. Валидация роли — только разрешённые для саморегистрации
    const ALLOWED_SELF_REGISTER_ROLES = [
      "CUSTOMER", "CONFECTIONER", "STUDIO", "SUPPLIER", "WHOLESALER",
      "COURIER", "VENUE_OWNER", "ANIMATOR_AGENCY", "RECREATION_CENTER",
      "KIDS_CLUB", "FOOD_SERVICE", "EVENT_ORGANIZER", "PICKUP_POINT",
      "BLOGGER", "TASTER", "NUTRITIONIST", "COPYWRITER",
      "CORPORATE_CLIENT", "FRANCHISEE",
    ];
    // Роли, доступные только по приглашению администратора
    const ADMIN_ASSIGNED_ROLES = ["ADMIN", "SUPER_ADMIN", "MODERATOR", "SUPPORT", "QUALITY_INSPECTOR", "CERTIFICATION_AGENT", "GUEST"];
    const finalRole = ALLOWED_SELF_REGISTER_ROLES.includes(role) ? role : "CUSTOMER";
    if (role && !ALLOWED_SELF_REGISTER_ROLES.includes(role) && ADMIN_ASSIGNED_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Роль "${role}" назначается только администратором после регистрации` },
        { status: 403 }
      );
    }

    // 2. Валидация
    if (!email || !password || !name || !phone) {
      return NextResponse.json(
        { error: "Заполните все обязательные поля: email, password, name, phone" },
        { status: 400 }
      );
    }
    if (typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { error: "email и password должны быть строками" },
        { status: 400 }
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов` },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase();

    // 3. Проверка уникальности email
    const { data: existingUser } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", emailLower)
      .maybeSingle();
    if (existingUser) {
      return NextResponse.json(
        { error: "Email уже зарегистрирован" },
        { status: 409 }
      );
    }

    // 4. Проверка уникальности телефона
    const { data: existingPhone } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (existingPhone) {
      return NextResponse.json(
        { error: "Телефон уже зарегистрирован" },
        { status: 409 }
      );
    }

    // 5. Проверка чёрного списка
    const [emailBl, phoneBl] = await Promise.all([
      supabaseAdmin
        .from("blacklist")
        .select("reason")
        .eq("scope", "email")
        .eq("value", emailLower)
        .eq("status", "active")
        .maybeSingle(),
      supabaseAdmin
        .from("blacklist")
        .select("reason")
        .eq("scope", "phone")
        .eq("value", phone)
        .eq("status", "active")
        .maybeSingle(),
    ]);

    if (emailBl.data) {
      return NextResponse.json(
        { error: `Email в чёрном списке: ${emailBl.data.reason}` },
        { status: 403 }
      );
    }
    if (phoneBl.data) {
      return NextResponse.json(
        { error: `Телефон в чёрном списке: ${phoneBl.data.reason}` },
        { status: 403 }
      );
    }

    // 6. Проверка организации через DaData (если legal)
    if (accountType === "legal" && legalInfo?.inn) {
      try {
        const { verifyOrganization, verifyLegalInfoMatches, recordVerification } = await import("@/lib/dadata");
        const verifyResult = await verifyOrganization(legalInfo.inn);

        if (verifyResult.normalized) {
          const match = verifyLegalInfoMatches(
            {
              inn: legalInfo.inn,
              ogrn: legalInfo.ogrn,
              companyName: legalInfo.companyName || "",
            },
            verifyResult.normalized
          );
          if (!match.matches) {
            return NextResponse.json(
              {
                error: "Данные организации не совпадают с ЕГРЮЛ/ЕГРИП",
                mismatches: match.mismatches,
              },
              { status: 400 }
            );
          }
        }

        if (!verifyResult.isAllowed && verifyResult.status !== "UNKNOWN") {
          await recordVerification(verifyResult, { trigger: "REGISTRATION" });
          return NextResponse.json(
            {
              error: `Регистрация отклонена: ${verifyResult.reason}`,
              status: verifyResult.status,
              inn: legalInfo.inn,
            },
            { status: 403 }
          );
        }
      } catch (e: any) {
        console.warn("[register] DaData verification failed (non-blocking):", e?.message);
      }
    }

    // 7. Создание пользователя в Supabase Auth
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: emailLower,
      password,
      email_confirm: false,
      user_metadata: { name, phone, role: finalRole, accountType },
    });

    if (authErr) {
      console.error("[register] supabase auth createUser error:", authErr.message);
      // Fallback: создаём запись только в profiles (для dev без Supabase Auth)
      // В прод нужно возвращать ошибку, т.к. без Supabase Auth пользователь не сможет войти
      if (process.env.NODE_ENV !== "development") {
        return NextResponse.json(
          { error: "Не удалось создать пользователя в Auth", details: authErr.message },
          { status: 500 }
        );
      }
      console.warn("[register] dev mode: skipping Supabase Auth creation");
    }

    const userId = authData?.user?.id || crypto.randomUUID();

    // 8. Создание записи в profiles
    const passwordHash = await hashPassword(password);
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: userId,
        email: emailLower,
        password_hash: passwordHash,
        name,
        phone,
        account_type: accountType,
        legal_info: legalInfo ?? null,
        loyalty_level: "BRONZE",
        bonus_balance: 0,
        is_blocked: false,
        is_verified: false,
      })
      .select("id, email, name, phone, account_type, city, bonus_balance, loyalty_level")
      .single();

    if (profileErr) {
      console.error("[register] profiles insert error:", profileErr.message);
      // Если создали в Auth, но не создали в profiles — откатываем Auth
      if (authData?.user?.id) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      }
      return NextResponse.json(
        { error: "Ошибка при создании профиля", details: profileErr.message },
        { status: 500 }
      );
    }

    // 9. Создание записи о ролях пользователя
    await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      role: finalRole,
      is_active: true,
      assigned_by: userId,
      assigned_at: new Date().toISOString(),
    });

    // 10. Создание referral записи
    const referralCode = `${name.toUpperCase().slice(0, 4)}-${userId.slice(-6).toUpperCase()}`;
    try {
      await supabaseAdmin.from("referrals").insert({
        user_id: userId,
        referral_code: referralCode,
      });
    } catch (refErr: any) {
      console.warn("[register] referral create failed (non-blocking):", refErr?.message);
    }

    // 11. Записать успешную верификацию (если legal)
    if (accountType === "legal" && legalInfo?.inn) {
      try {
        const { verifyOrganization, recordVerification } = await import("@/lib/dadata");
        const result = await verifyOrganization(legalInfo.inn);
        await recordVerification(result, {
          userId,
          trigger: "REGISTRATION",
        });
      } catch (e: any) {
        console.warn("[register] post-create verification log failed:", e?.message);
      }
    }

    // 12. Генерация токенов
    const tokenPayload = {
      userId,
      email: emailLower,
      roles: [finalRole],
      accountType,
    };

    const accessToken = await createAccessToken(tokenPayload);
    const refreshToken = await createRefreshToken({ userId });

    // 13. Sanitize response (без passwordHash и других sensitive полей)
    const safeUser: SanitizedUser = {
      id: userId,
      email: emailLower,
      name,
      phone,
      roles: [finalRole],
      accountType,
      city: profile?.city || null,
      bonusBalance: profile?.bonus_balance || 0,
      loyaltyLevel: profile?.loyalty_level || "BRONZE",
    };

    // 14. Яндекс Метрика: server-side трекинг регистрации (non-blocking)
    import("@/lib/yandex-metrika")
      .then(({ trackEventServer }) =>
        trackEventServer("user_registered", {
          user_id: userId,
          role: finalRole,
          city: safeUser.city,
        }).catch(() => {})
      )
      .catch(() => {});

    // 15. Telegram уведомление о новом пользователе (non-blocking)
    import("@/lib/telegram-bot")
      .then(({ sendToChannel }) =>
        sendToChannel(
          `👤 <b>Новая регистрация</b>\n\n<b>Имя:</b> ${name}\n<b>Email:</b> ${emailLower}\n<b>Роль:</b> ${finalRole}`
        ).catch(() => {})
      )
      .catch(() => {});

    // 16. Email: welcome письмо (non-blocking)
    import("@/lib/email")
      .then(({ sendTemplateEmail }) =>
        sendTemplateEmail("welcome", {
          to: emailLower,
          toName: name,
          userId,
          params: { name, email: emailLower },
        }).catch(() => {})
      )
      .catch(() => {});

    return NextResponse.json({
      user: safeUser,
      accessToken,
      refreshToken,
    });
  } catch (error: any) {
    console.error("Register error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: error?.message },
      { status: 500 }
    );
  }
}
