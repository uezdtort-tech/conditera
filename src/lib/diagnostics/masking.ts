/**
 * masking.ts — защита персональных данных и секретов в диагностических
 * событиях (DEPLOY-01 §3.2).
 *
 * Инварианты:
 *   • НИЧЕГО не сохраняется в app_error_events без прохода через scrub()
 *     / maskString() этой библиотеки (единая точка фильтрации).
 *   • Поддержка log injection: управляющие символы и переводы строк
 *     вырезаются/эскейпятся (одна строка = одна запись).
 *   • Лимиты размера: длинные строки обрезаются (MAX_STRING), суммарный
 *     размер стека/метаданных ограничен (MAX_STACK / MAX_METADATA_CHARS).
 *   • Глубокая рекурсия объектов ограничена (MAX_DEPTH) + защита от
 *     циклических ссылок (seen-set).
 *
 * Не подключать к централизованному сбору источники, для которых
 * маскирование гарантировать нельзя (см. docs/operations/ERROR_TRACKING.md).
 */

/** Максимальная длина одной строки после маскирования. */
export const MAX_STRING = 512;
/** Максимальный размер сериализованных метаданных (символов). */
export const MAX_METADATA_CHARS = 4000;
/** Максимальный размер stack trace (символов). */
export const MAX_STACK_CHARS = 8000;
/** Максимальная глубина обхода объектов. */
export const MAX_DEPTH = 6;

/**
 * Ключи, значения которых маскируются целиком (регистронезависимо,
 * вхождение подстроки). Поля с такими ключами НЕ сохраняются даже в
 * усечённом виде — только placeholder.
 */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /pass(word)?/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /auth[-_]?cookie/i,
  /api[-_]?key/i,
  /apikey/i,
  /client[-_]?secret/i,
  /private[-_]?key/i,
  /refresh[-_]?session/i,
  /session/i,
  /cookie/i,
  /card[-_]?number/i,
  /cvc|cvv|card[-_]?code/i,
  /bank/i,
  /yookassa/i,
  /otp|2fa|two[-_]?factor/i,
  /telegram[-_]?bot/i,
  /cron[-_]?secret/i,
  /jwt/i,
  /dsn/i,
  /salt/i,
  /password[-_]?hash/i,
  /encrypted/i,
  /email/i, // персональные данные: e-mail не сохраняем в событиях
  /phone/i, // персональные данные: телефон не сохраняем
  /inn|kpp|snils/i, // персональные данные
];

/** Placeholder вместо маскированного значения. */
export const REDACTED = "[REDACTED]";

/** Сеть-паттерны значений, маскируемых даже под «безопасными» ключами. */
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  // JWT (eyJ... три сегмента base64url)
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  // Bearer-токены
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
  // sk-/pk- ключи стилей Stripe и похожие
  /\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}/g,
  // service_role / supabase ключи (длинный base64url-фрагмент ≥40)
  /\b[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}/g,
  // пароль в URL: scheme://user:pass@host
  /:\/\/[^/\s:@]+:[^/\s@]+@/g,
  // банковская карта (13–19 цифр с разделителями)
  /\b(?:\d[ -]?){13,19}\b/g,
];

/**
 * Вырезать управляющие символы и нормализовать переводы строк —
 * защита от log injection (DEPLOY-01 §3.2).
 */
export function stripControlChars(input: string): string {
  // \n и \r → пробел (строка остаётся однострочной), прочее C0/C1 → удалить
  return input
    .replace(/[\r\n]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

/** Обрезать строку до max с хвостовой пометкой. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}…[truncated ${input.length - max} chars]`;
}

/**
 * Маскировать секреты ВНУТРИ произвольной строки (стек, сообщение).
 * Сначала pattern-маскирование значений, потом контроль символов и размер.
 */
export function maskString(input: string, max: number = MAX_STRING): string {
  if (!input) return "";
  let out = input;
  for (const re of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  out = stripControlChars(out);
  return truncate(out, max);
}

/** Проверить, является ли ключ чувствительным. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Глубокая очистка объекта: чувствительные ключи → REDACTED, строки →
 * maskString, лимиты глубины/размера. Возвращает НОВЫЙ объект
 * (вход не мутируется). Безопасен для циклических ссылок.
 */
export function scrub(
  value: unknown,
  depth: number = 0,
  seen: Set<object> = new Set()
): unknown {
  if (value === null || value === undefined) return null;

  const t = typeof value;
  if (t === "string") return maskString(value as string);
  if (t === "number") {
    const n = value as number;
    return Number.isFinite(n) ? n : null;
  }
  if (t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "function" || t === "symbol") return `[${t}]`;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    // Error сериализуем безопасно: name+message (маскированные)
    return { name: (value as Error).name, message: maskString((value as Error).message) };
  }

  if (depth >= MAX_DEPTH) return "[max-depth]";

  const obj = value as object;
  if (seen.has(obj)) return "[circular]";
  seen.add(obj);

  if (Array.isArray(obj)) {
    const arr: unknown[] = [];
    for (const item of obj.slice(0, 50)) {
      arr.push(scrub(item, depth + 1, seen));
    }
    if (obj.length > 50) arr.push(`[+${obj.length - 50} more]`);
    return arr;
  }

  const out: Record<string, unknown> = {};
  let chars = 0;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      out[k] = REDACTED;
      continue;
    }
    const cleaned = scrub(v, depth + 1, seen);
    const serialized =
      typeof cleaned === "string" ? cleaned : (JSON.stringify(cleaned) ?? "");
    // Проверка ДО добавления: суммарный размер (значения + JSON-накладные
    // на ключ/кавычки/запятую) не превышает лимит
    const entryLen = serialized.length + k.length + 5;
    if (chars + entryLen > MAX_METADATA_CHARS) {
      out[k] = "[metadata-size-limit]";
      break;
    }
    chars += entryLen;
    out[k] = cleaned;
  }
  return out;
}

/**
 * Маскировать stack trace: маскирование секретов в каждой строке,
 * лимит размера. Вход только от сервера (клиентский ingest стек отклоняет).
 */
export function maskStackTrace(stack: string | undefined | null): string | null {
  if (!stack) return null;
  return maskString(stack, MAX_STACK_CHARS);
}

/**
 * Безопасно сериализовать объект в JSON-строку для jsonb-колонки.
 */
export function safeJsonStringify(value: Record<string, unknown> | undefined): string {
  try {
    const cleaned = scrub(value ?? {});
    return JSON.stringify(cleaned ?? {});
  } catch {
    return "{}";
  }
}
