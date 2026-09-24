/**
 * Safe Field Selection — helper для исключения чувствительных полей из запросов.
 *
 * ПРОБЛЕМА:
 *   Если делать `supabaseAdmin.from('profiles').select('*')`, в ответ попадут
 *   поля password_hash, tfa_secret, last_login_ip и т.п. — это leak sensitive data.
 *
 * РЕШЕНИЕ:
 *   Использовать string select с явно перечисленными полями (белый список),
 *   исключая sensitive.
 *
 * ПРИМЕР:
 *   import { USER_PUBLIC_FIELDS } from '@/lib/prisma-safe-select'
 *   const { data } = await supabaseAdmin.from('profiles').select(USER_PUBLIC_FIELDS)
 *
 * Альтернатива: использовать RLS policies (Postgres Row Level Security), которые
 * на уровне БД скрывают sensitive поля от не-админских запросов.
 */

// ===== User: публичные поля (для отображения в UI) — snake_case как в реальной БД =====
export const USER_PUBLIC_FIELDS = [
  "id",
  "email",
  "name",
  "phone",
  "avatar",
  "account_type",
  "legal_info",
  "city",
  "loyalty_level",
  "bonus_balance",
  "is_blocked",
  "blocked_reason",
  "tfa_enabled",
  "tfa_required_for",
  "is_bot",
  "bot_role",
  "created_at",
  "updated_at",
].join(", ");

// ===== User: поля доступные самому пользователю (для своего профиля) =====
export const USER_SELF_FIELDS = [
  ...USER_PUBLIC_FIELDS.split(", "),
  "last_login_at",
].join(", ");

// ===== User: поля для админа (но без критических секретов) =====
export const USER_ADMIN_FIELDS = [
  ...USER_SELF_FIELDS.split(", "),
  "last_login_ip",
].join(", ");

// ===== RefreshToken: только id и metadata, не сам token =====
export const REFRESH_TOKEN_METADATA_FIELDS = [
  "id",
  "user_id",
  "device",
  "user_agent",
  "ip_address",
  "expires_at",
  "created_at",
].join(", ");

// ===== Список всех чувствительных полей по моделям (для аудита) =====
export const SENSITIVE_FIELDS: Record<string, string[]> = {
  User: ["password_hash", "tfa_secret", "tfa_backup_codes", "last_login_ip"],
  RefreshToken: ["refresh_token"],
  // Добавляйте сюда новые поля при расширении схемы
};

/**
 * Хелпер для динамического построения select с исключением полей.
 *
 * @example
 *   const select = omitSensitive('User', "id, email, password_hash")
 *   // select = "id, email" — password_hash убран
 */
export function omitSensitive(
  model: keyof typeof SENSITIVE_FIELDS,
  selectStr: string
): string {
  const sensitive = SENSITIVE_FIELDS[model] || [];
  const fields = selectStr
    .split(",")
    .map((s) => s.trim())
    .filter((field) => !sensitive.includes(field));
  return fields.join(", ");
}

/**
 * Audit-функция: проверяет что в объекте нет чувствительных полей.
 * Использовать в тестах или как assertion перед возвратом ответа.
 *
 * @example
 *   const response = { user: { id: '...', password_hash: '...' } }
 *   assertNoSensitiveFields(response, 'User')
 *   // throws Error "Response contains sensitive field 'password_hash'"
 */
export function assertNoSensitiveFields(
  obj: unknown,
  model: keyof typeof SENSITIVE_FIELDS,
  path = ""
): void {
  if (!obj || typeof obj !== "object") return;
  const sensitive = SENSITIVE_FIELDS[model] || [];

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertNoSensitiveFields(obj[i], model, `${path}[${i}]`);
    }
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (sensitive.includes(key)) {
      throw new Error(
        `Response contains sensitive field '${currentPath}' (model: ${model}). ` +
          `Use USER_PUBLIC_FIELDS/USER_SELF_FIELDS/USER_ADMIN_FIELDS from @/lib/prisma-safe-select instead.`
      );
    }
    const value = record[key];
    if (value && typeof value === "object") {
      assertNoSensitiveFields(value, model, currentPath);
    }
  }
}

/**
 * Универсальный sanitiser для ответов API — удаляет известные чувствительные поля
 * из ЛЮБОГО объекта (по имени поля, без привязки к модели).
 *
 * Использовать как последний рубеж: если забыл сделать select — sanitiser уберёт.
 *
 * @example
 *   return NextResponse.json(sanitizeResponse(user))
 */
export function sanitizeResponse<T>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeResponse) as unknown as T;
  }

  const ALL_SENSITIVE = new Set<string>(
    Object.values(SENSITIVE_FIELDS).flat()
  );
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (ALL_SENSITIVE.has(key)) continue;
    result[key] = value && typeof value === "object"
      ? sanitizeResponse(value)
      : value;
  }
  return result as unknown as T;
}
