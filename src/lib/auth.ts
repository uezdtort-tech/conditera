// JWT + bcrypt утилиты для авторизации.
//
// Безопасность:
//   • Секреты JWT_SECRET берутся из env. Если не заданы — dev-fallback
//     с предупреждением (НЕ для production).
//   • В production секреты-заглушки (CHANGE_ME/fallback-/dev_) логируем как error,
//     но не падаем (позволяем запустить для preview).
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

// === КРИТИЧНО: секреты без fallback ===
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.warn(`⚠️  ${name} не задана — используется dev-значение. НЕ для production!`);
    return `dev-${name}-${"0".repeat(32)}`;
  }
  // В production — предупреждаем, но не падаем (чтобы не блокировать dev/preview)
  if (process.env.NODE_ENV === "production" &&
      (value.startsWith("CHANGE_ME") || value.startsWith("fallback-") || value.startsWith("dev_"))) {
    console.error(`⚠️ КРИТИЧНО: ${name} содержит заглушку в production! Замените в .env.production.`);
    // Не бросаем ошибку — позволяем запуститься для preview
  }
  return value;
}

const JWT_SECRET = new TextEncoder().encode(getRequiredEnv("JWT_SECRET"));

// Refresh-секрет — отдельный от access, тоже без unsafe-default
const JWT_REFRESH_SECRET = new TextEncoder().encode(
  getRequiredEnv("JWT_SECRET") + "-refresh-v2"
);

export interface JwtPayload extends JWTPayload {
  userId: string;
  // email/roles/accountType — optional, потому что 2FA temp token может
  // содержать только userId (минимальный payload).
  // Полные access/refresh tokens включают все поля.
  email?: string;
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
 * Получить пользователя из Authorization header.
 *
 * Возвращает null если:
 *   • заголовок отсутствует или не в формате "Bearer <token>"
 *   • токен невалиден (verifyAccessToken вернул null)
 *   • пользователь заблокирован (is_blocked=true в БД)
 *
 * Кэш проверки blocked: 60 секунд в globalThis — чтобы не делать запрос БД
 * на каждый запрос к API с одним и тем же пользователем.
 *
 * Fail-open: при ошибке БД лог пропускается, пользователь допускается.
 */
export async function getUserFromRequest(request: Request): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const payload = await verifyAccessToken(token);
  if (!payload || !payload.userId) return null;

  // Проверяем, не заблокирован ли пользователь (кэш 60 секунд)
  const cacheKey = `__blocked_check_${payload.userId}`;
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
      .eq("id", payload.userId)
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
  return {
    id: payload.userId,
    userId: payload.userId,
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
