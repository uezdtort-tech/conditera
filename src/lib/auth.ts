// JWT + bcrypt утилиты для авторизации.
//
// Безопасность:
//   • Секреты JWT_SECRET / JWT_REFRESH_SECRET берутся из env (fail-closed):
//     в production отсутствие/заглушка → процесс не стартует; в dev — dev-fallback
//     с предупреждением.
//   • Все токены подписаны HS256.
//   • Access token: 7d по умолчанию.
//   • Refresh token: 30d, отдельный секрет.
//   • 2FA temp token: 5m, отдельный секрет.
//
// Type safety:
//   • Все публичные функции принимают и возвращают типизированные объекты.
//   • JwtPayload содержит только известные поля; дополнительные клеймы — через index.
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUserSessionActive } from "@/lib/session-registry";

// === КРИТИЧНО: секреты fail-closed ===
//
// Production: отсутствие секрета или заглушка (CHANGE_ME/fallback-/dev-/dev_)
// → процесс отказывается стартовать (throw на module load).
//   Исключение — фаза сборки (NEXT_PHASE=phase-production-build, `next build`):
//   во время пререндера секреты могут быть недоступны, поэтому там — placeholder
//   + warning; runtime всё равно потребует реальное значение.
// Development: dev-значение с явным предупреждением.
function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  const normalized = value.toLowerCase();
  const isStub =
    !value ||
    /^(change_me|fallback-|dev[-_]|stub[-_]|placeholder|example|dummy|test[-_])/i.test(value);
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

  if (process.env.NODE_ENV === "production" && (isStub || value.length < 32)) {
    if (isBuildPhase) {
      console.warn(
        `[auth] ${name} отсутствует/недействителен на этапе production-сборки; ` +
          "используется временный ключ только для build. Runtime потребует настоящий секрет."
      );
      return `build-placeholder-${name}-${"0".repeat(24)}`;
    }
    throw new Error(
      `[auth] ${name} отсутствует, слишком короткий или содержит заглушку в production. ` +
        "Отказ запуска. Задайте независимый секрет длиной не менее 32 символов."
    );
  }

  if (isStub || value.length < 32) {
    console.warn(`[auth] ${name} не задана или слишком короткая — используется dev-значение. НЕ для production!`);
    return `dev-${name}-${"0".repeat(32)}`;
  }
  if (/^dev[-_]/.test(normalized)) {
    console.warn(`[auth] ${name} использует development-only значение; не переносить в production.`);
  }
  return value;
}

// JWT и refresh используют два обязательных независимых секрета.
// Альтернативные имена намеренно не принимаются: одна переменная не может
// незаметно стать ключом и access-, и refresh-токенов.
const jwtSecretValue = getRequiredEnv("JWT_SECRET");
const jwtRefreshSecretValue = getRequiredEnv("JWT_REFRESH_SECRET");
if (jwtSecretValue === jwtRefreshSecretValue) {
  throw new Error("[auth] JWT_SECRET и JWT_REFRESH_SECRET должны быть разными значениями.");
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretValue);
const JWT_REFRESH_SECRET = new TextEncoder().encode(jwtRefreshSecretValue);

export interface JwtPayload extends JWTPayload {
  userId: string;
  // email/roles/accountType — optional, потому что 2FA temp token может
  // содержать только userId (минимальный payload).
  // Полные access/refresh tokens включают все поля.
  email?: string;
  // name — display-name профиля (использует /api/auth/session для UI)
  name?: string;
  roles?: string[];
  accountType?: string;
  sid?: string;
  jti?: string;
}

export interface AuthenticatedUser {
  /**
   * ID пользователя в БД. Поле названо userId (а не id) для обратной
   * совместимости с уже написанными API routes, которые читают
   * user.userId. При последующей миграции можно переименовать в id.
   */
  userId: string;
  id: string; // alias для userId — для новых routes
  name?: string;
  email: string;
  roles: string[];
  accountType: string;
}

interface UserRow {
  id: string;
  is_blocked: boolean | null;
  name: string | null;
  email: string | null;
  account_type: string | null;
  deleted_at: string | null;
}

interface SupabaseError {
  message: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createAccessToken(payload: JwtPayload): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_EXPIRES_IN || "7d")
    .sign(JWT_SECRET);
}

export async function createRefreshToken(payload: JwtPayload): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_REFRESH_EXPIRES_IN || "30d")
    .sign(JWT_REFRESH_SECRET);
}

export async function verifyAccessToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_REFRESH_SECRET);
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Извлечь access-токен из запроса — единый контракт (cookie + Bearer):
 *   1. Authorization: Bearer <jwt> — программные клиенты (e2e, интеграции)
 *   2. cookie cd_session — браузерная сессия, выпущенная /api/auth/login
 *      (консолидация: раньше cookie-пользователь получал 401 на 163 роутах)
 *   3. cookie sb-*-auth-token — сессия Supabase GoTrue (self-hosted секрет
 *      совпадает с JWT_SECRET; поддержка chunked (.0/.1/...) и форматов
 *      "base64-<b64json>" / <json>)
 */
function extractTokenFromRequest(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const cookieHeader = request.headers.get("cookie") || "";
  if (!cookieHeader) return null;

  // Парсер cookie-пар с аккуратным декодированием значения
  const pairs = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      // значение не URL-кодировано — используем как есть
    }
    pairs.set(name, value);
  }

  // 2. App-сессия
  const appToken = pairs.get("cd_session");
  if (appToken) return appToken;

  // 3. Supabase-сессия: собрать chunks (name, name.0..name.N) и достать access_token
  for (const [name, value] of pairs) {
    const m = name.match(/^sb-[A-Za-z0-9_-]+-auth-token$/);
    if (!m) continue;

    let raw = value;
    // Chunked формат: базовое имя присутствует как пустая заглушка,
    // полезная нагрузка в name.0, name.1, ...
    const chunks: string[] = [];
    let chunkIdx = 0;
    let chunkValue: string | undefined;
    while ((chunkValue = pairs.get(`${name}.${chunkIdx}`)) !== undefined) {
      chunks.push(chunkValue);
      chunkIdx++;
    }
    if (chunks.length > 0) raw = chunks.join("");

    try {
      let jsonText = raw;
      if (jsonText.startsWith("base64-")) {
        jsonText = Buffer.from(jsonText.slice(7), "base64").toString("utf8");
      }
      const session = JSON.parse(jsonText) as { access_token?: string };
      if (session?.access_token) return session.access_token;
    } catch {
      // не JSON/не session-cookie — пробуем следующее имя
    }
  }

  return null;
}

/**
 * Получить пользователя из запроса — ЕДИНЫЙ auth-контракт.
 *
 * Порядок источников токена:
 *   1. Authorization: Bearer <token>
 *   2. cookie cd_session (app-сессия из /api/auth/login)
 *   3. cookie sb-*-auth-token (Supabase GoTrue, совместимый секрет)
 *
 * Возвращает null если:
 *   • ни один источник не дал валидный токен
 *   • токен невалиден (verifyAccessToken вернул null)
 *   • профиль отсутствует/заблокирован или не удалось проверить БД
 *
 * Роли и атрибуты пользователя читаются из БД на каждом запросе, а не из
 * потенциально устаревших JWT claims. Изменение/отзыв роли применяется сразу.
 * Fail-closed: при любой ошибке чтения запрос отклоняется.
 */
export async function getUserFromRequest(request: Request): Promise<AuthenticatedUser | null> {
  const token = extractTokenFromRequest(request);
  if (!token) return null;
  const payload = await verifyAccessToken(token);
  // Поддержка двух форматов токена:
  //   • app-JWT (создан /api/auth/login): payload.userId
  //   • GoTrue-JWT (signInWithPassword в браузере, секрет общий с Supabase-стеком):
  //     payload.sub, JWT-claims как у Supabase (role/email в top-level)
  const userId = payload?.userId || (payload as { sub?: string } | null)?.sub;
  if (!payload || !userId) return null;

  // Production app-JWT must be bound to an active server-side session.
  // Legacy sid-less tokens are tolerated only in non-production environments.
  if (!payload.sid) {
    if (process.env.NODE_ENV === "production") return null;
  } else {
    try {
      if (!(await isUserSessionActive(payload.sid, userId))) return null;
    } catch (sessionError) {
      console.error("[auth] session validation threw; rejecting request:", sessionError);
      return null;
    }
  }

  try {
    const profileResult = await supabaseAdmin
      .from("profiles")
      .select("id, is_blocked, name, email, account_type, deleted_at")
      .eq("id", userId)
      .maybeSingle() as { data: UserRow | null; error: SupabaseError | null };

    if (profileResult.error) {
      console.error("[auth] profile validation failed; rejecting request:", profileResult.error.message);
      return null;
    }

    const profile = profileResult.data;
    if (!profile || profile.is_blocked === true || Boolean(profile.deleted_at)) {
      console.warn("[auth] profile missing, blocked or deleted; rejecting request:", userId);
      return null;
    }

    // JWT claims не являются источником актуальных полномочий: роли могли
    // быть отозваны или изменены после выдачи access token.
    const rolesResult = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (rolesResult.error) {
      console.error("[auth] role lookup failed; rejecting request:", rolesResult.error.message);
      return null;
    }

    const roles = (rolesResult.data || []).map((item: { role: string }) => item.role);
    return buildUserFromPayload(payload, profile, roles);
  } catch (err) {
    console.error(
      "[auth] authentication state lookup threw; rejecting request:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

function buildUserFromPayload(
  payload: JwtPayload,
  profile: UserRow,
  roles: string[]
): AuthenticatedUser {
  const sub = (payload as { sub?: string }).sub;
  return {
    id: profile.id,
    userId: profile.id,
    email: profile.email || payload.email || "",
    name: profile.name || (typeof payload.name === "string" ? payload.name : undefined),
    roles,
    accountType: profile.account_type || payload.accountType || "",
  };
}

// =========================================================
// 2FA: короткоживущий временный токен для stage-2 логина.
// Используется между /api/auth/login (пароль верный, но 2FA нужен)
// и /api/auth/2fa/login-verify (ввод кода). Срок жизни — 5 минут.
// =========================================================
const TFA_TEMP_SECRET = new TextEncoder().encode(
  getRequiredEnv("JWT_SECRET") + "-tfa-temp"
);

export interface TfaTempPayload extends JWTPayload {
  userId: string;
  email: string;
  roles: string[];
  accountType: string;
  tfa_pending: true;
}

export async function createTfaLoginToken(payload: {
  userId: string;
  email: string;
  roles: string[];
  accountType: string;
}): Promise<string> {
  return new SignJWT({ ...payload, tfa_pending: true } as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m") // короткий срок — 5 минут на ввод кода
    .sign(TFA_TEMP_SECRET);
}

export async function verifyTfaLoginToken(token: string): Promise<TfaTempPayload | null> {
  try {
    const { payload } = await jwtVerify(token, TFA_TEMP_SECRET);
    const typed = payload as unknown as TfaTempPayload;
    if (!typed.tfa_pending) return null;
    return typed;
  } catch {
    return null;
  }
}
