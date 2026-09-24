/**
 * http-helpers.ts — общие утилиты для API route handlers.
 *
 * Решает повторяющиеся проблемы:
 *   1. `await request.json()` бросает SyntaxError при невалидном JSON.
 *      Внешний try-catch возвращает 500, но это должен быть 400 Bad Request.
 *   2. Унарные проверки `body.field` без type narrowing требуют дублирования.
 *   3. Не во всех routes есть единый формат ошибки.
 *
 * Безопасность:
 *   • safeJsonBody логирует и возвращает null вместо throw.
 *   • parseJsonBody выбрасывает HttpError(400) с понятным сообщением,
 *     которое ловится `handleRouteError`.
 */

import { NextRequest, NextResponse } from "next/server";

export interface ApiError {
  error: string;
  detail?: string;
}

/**
 * Безопасный парсинг JSON-тела запроса.
 * Возвращает { data, error } — НЕ бросает исключение при невалидном JSON.
 *
 * @example
 * const { data, error } = await safeJsonBody<MyBody>(request);
 * if (error) return NextResponse.json({ error: error }, { status: 400 });
 */
export async function safeJsonBody<T = unknown>(
  request: NextRequest | Request
): Promise<{ data: T | null; error: string | null }> {
  try {
    const raw = await request.text();
    if (!raw || raw.length === 0) {
      return { data: null, error: "Тело запроса пусто" };
    }
    try {
      return { data: JSON.parse(raw) as T, error: null };
    } catch (parseErr: any) {
      return { data: null, error: `Невалидный JSON: ${parseErr?.message || "parse error"}` };
    }
  } catch (readErr: any) {
    return { data: null, error: `Не удалось прочитать тело: ${readErr?.message || "read error"}` };
  }
}

/**
 * HTTP-ошибка с кодом состояния и сообщением.
 * Используется для явного управления потоком ошибок в route handlers.
 *
 * @example
 * if (!user) throw new HttpError(401, "Не авторизован");
 * try { ... } catch (e) { handleRouteError(e); }
 */
export class HttpError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.detail = detail;
  }

  static badRequest(message: string, detail?: string) {
    return new HttpError(400, message, detail);
  }

  static unauthorized(message = "Не авторизован") {
    return new HttpError(401, message);
  }

  static forbidden(message = "Недостаточно прав") {
    return new HttpError(403, message);
  }

  static notFound(message = "Не найдено") {
    return new HttpError(404, message);
  }

  static unprocessable(message: string, detail?: string) {
    return new HttpError(422, message, detail);
  }

  static tooMany(message = "Слишком много запросов") {
    return new HttpError(429, message);
  }

  static internal(message = "Внутренняя ошибка", detail?: string) {
    return new HttpError(500, message, detail);
  }
}

/**
 * Единый обработчик ошибок route handler.
 *
 * @example
 * export async function POST(request: NextRequest) {
 *   try {
 *     // ... бизнес-логика, может бросать HttpError
 *   } catch (error) {
 *     return handleRouteError(error);
 *   }
 * }
 */
export function handleRouteError(error: unknown): NextResponse<ApiError> {
  // HttpError — контролируемая бизнес-ошибка, логируем на info-уровне.
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      console.error(`[route] ${error.status}: ${error.message}`, error.detail);
    } else {
      console.info(`[route] ${error.status}: ${error.message}`);
    }
    return NextResponse.json(
      { error: error.message, detail: error.detail },
      { status: error.status }
    );
  }

  // Прочие ошибки — unexpected, логируем как error.
  const err = error as Error;
  console.error("[route] unhandled error:", err?.message, err?.stack);
  return NextResponse.json(
    { error: "Внутренняя ошибка сервера" },
    { status: 500 }
  );
}

/**
 * Проверка, что обязательное поле присутствует в теле запроса.
 * @returns error message если поле отсутствует/пустое, null если валидно.
 *
 * @example
 * const nameErr = requireField(body.name, "name");
 * if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 });
 */
export function requireField(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return `Поле "${fieldName}" обязательно`;
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return `Поле "${fieldName}" не может быть пустым`;
  }
  return null;
}

/**
 * Безопасное чтение string-поля из объекта с проверкой длины.
 */
export function readStringField(
  obj: Record<string, unknown>,
  field: string,
  opts?: { maxLength?: number; required?: boolean }
): { value: string | null; error: string | null } {
  const v = obj[field];
  if (v === undefined || v === null) {
    if (opts?.required) {
      return { value: null, error: `Поле "${field}" обязательно` };
    }
    return { value: null, error: null };
  }
  if (typeof v !== "string") {
    return { value: null, error: `Поле "${field}" должно быть строкой` };
  }
  const trimmed = v.trim();
  if (opts?.required && trimmed.length === 0) {
    return { value: null, error: `Поле "${field}" не может быть пустым` };
  }
  if (opts?.maxLength && trimmed.length > opts.maxLength) {
    return {
      value: null,
      error: `Поле "${field}" слишком длинное (макс ${opts.maxLength} символов)`,
    };
  }
  return { value: trimmed, error: null };
}

/**
 * Проверка допустимого значения из enum-like массива.
 */
export function readEnumField<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  opts?: { required?: boolean }
): { value: T | null; error: string | null } {
  const v = obj[field];
  if (v === undefined || v === null) {
    if (opts?.required) {
      return { value: null, error: `Поле "${field}" обязательно` };
    }
    return { value: null, error: null };
  }
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    return {
      value: null,
      error: `Поле "${field}" должно быть одним из: ${allowed.join(", ")}`,
    };
  }
  return { value: v as T, error: null };
}
