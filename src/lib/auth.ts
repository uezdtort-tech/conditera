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

// === КРИТИЧНО: секреты fail-closed ===
//
// Production: отсутствие секрета или заглушка (CHANGE_ME/fallback-/dev-/dev_)
// → процесс отказывается стартовать (throw на module load).
//   Исключение — фаза сборки (NEXT_PHASE=phase-production-build, `next build`):
//   во время пререндера секреты могут быть недоступны, поэтому там — placeholder
//   + warning; runtime всё равно потребует реальное значение.
// Development: dev-значение с явным предупреждением.
function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  const isStub =
    !value ||
    value.startsWith("CHANGE_ME") ||
    value.startsWith("fallback-") ||
    value.startsWith("dev-") ||
    value.startsWith("dev_");

  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

  if (process.env.NODE_ENV === "production") {
    if (isStub) {
      if (isBuildPhase) {
        console.warn(
          `⚠️  [auth] ${name} отсутствует/заглушка во время production-сборки — ` +
            `используется placeholder. РАНТАЙМ всё равно потребует реальное значение!`
        );
        return `build-placeholder-${name}-${"0".repeat(24)}`;
      }
      throw new Error(
        `[auth] ${name} отсутствует или содержит заглушку в production. ` +
          `Отказ запуска. Задайте реальный секрет (openssl rand -hex 32) в окружении.`
      );
    }
    return value;
  }

  // development / preview — только с предупреждением
  if (isStub) {
    console.warn(`⚠️  [auth] ${name} не задана — используется dev-значение. НЕ для production!`);
    return `dev-${name}-${"0".repeat(32)}`;
  }
  return value;
}

/**
 * Секретные env с фолбэком на альтернативные имена (.env.example декларирует
 * AUTH_SECRET как каноничное имя, исторический код читает JWT_SECRET).
 * Первая непустая незаглушечная переменная побеждает; иначе — обычный
 * getRequiredEnv(primary) со стандартными предупреждениями.
 */
function getSecretEnv(primary: string, fallbacks: string[]): string {
  for (const name of [primary, ...fallbacks]) {
    const v = process.env[name]?.trim();
    if (v && !v.startsWith("CHANGE_ME") && !v.startsWith("fallback-") && !v.startsWith("dev-") && !v.startsWith("dev_")) {
      return v;
    }
  }
  return getRequiredEnv(primary);
}

const JWT_SECRET = new TextEncoder().encode(getSecretEnv("JWT_SECRET", ["AUTH_SECRET"]));

// Refresh-секрет — отдельная env-переменная (НЕ производная от JWT_SECRET).
// ВНИМАНИЕ: после перехода на JWT_REFRESH_SECRET все прежние refresh-токены
// инвалидируются — пользователи один раз перелогинятся.
const JWT_REFRESH_SECRET = new TextEncoder().encode(
  getSecretEnv("JWT_REFRESH_SECRET", ["AUTH_REFRESH_SECRET", "AUTH_SECRET"])
);

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

interface BlockedUserCacheEntry {
  ts: number;
  blocked: boolean;
}

interface UserRow {
  id: string;
  is_blocked: boolean | null;
  name: string | null;
  email: string | null;
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
 *   • пользователь заблокирован (is_blocked=true в БД)
 *
 * Кэш проверки blocked: 60 секунд в globalThis — чтобы не делать запрос БД
 * на каждый запрос к API с одним и тем же пользователем.
 *
 * Fail-open: при ошибке БД лог пропускается, пользователь допускается.
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

  // Проверяем, не заблокирован ли пользователь (кэш 60 секунд)
  const cacheKey = `__blocked_check_${userId}`;
  const cacheStore = globalThis as unknown as Record<string, BlockedUserCacheEntry>;
  const cached = cacheStore[cacheKey];
  if (cached && Date.now() - cached.ts < 60_000) {
    if (cached.blocked) return null;
    return buildUserFromPayload(payload);
  }

  try {
    const result = await supabaseAdmin
      .from("profiles")
      .select("id, is_blocked, name, email")
      .eq("id", userId)
      .maybeSingle() as { data: UserRow | null; error: SupabaseError | null };
    const user = result.data;
    const error = result.error;

    if (error) {
      console.warn("[auth] blocked-check failed:", error.message);
      // Fail-open — продолжаем без проверки блокировки.
      return buildUserFromPayload(payload);
    }

    const isBlocked = user?.is_blocked === true;
    cacheStore[cacheKey] = { ts: Date.now(), blocked: isBlocked };
    if (isBlocked) return null;
  } catch (err) {
    // If DB check fails, allow (don't block legitimate users due to DB issues)
    console.warn("[auth] blocked-check error:", err instanceof Error ? err.message : String(err));
  }

  return buildUserFromPayload(payload);
}

function buildUserFromPayload(payload: JwtPayload): AuthenticatedUser {
  const sub = (payload as { sub?: string }).sub;
  return {
    id: payload.userId || sub || "",
    userId: payload.userId || sub || "",
    email: payload.email || "",
    name: typeof payload.name === "string" ? payload.name : undefined,
    roles: payload.roles || [],
    accountType: payload.accountType || "",
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
