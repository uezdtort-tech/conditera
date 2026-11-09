/**
 * capture.ts — точки врезки централизованной регистрации ошибок
 * (DEPLOY-01 §3): сервер (API/крон/чат-хуки) и клиент (browser).
 *
 * Правила:
 *   • captureServer — fire-and-forget, ничего не бросает, не влияет на
 *     ответ маршрута (§3.3);
 *   • correlationId/requestId — берутся из существующих заголовков запроса
 *     (x-request-id) или middleware, НЕ копируют тело/заголовки запроса;
 *   • captureClient — отправляет МАСКИРОВАННЫЙ минимальный payload
 *     в /api/diagnostics/client-errors; стек на сервер НЕ передаётся.
 */

import { storeErrorEvent, type DiagnosticComponent, type Severity } from "./event-store";

/** Компоненты Conditera для привязки событий (§3, таблица охвата). */
export const CAPTURE_COMPONENTS = {
  frontend: "frontend",
  api: "api",
  database: "database",
  auth: "auth",
  orders: "orders",
  payments: "payments",
  chat: "chat",
  inventory: "inventory",
  recipes: "recipes",
  infrastructure: "infrastructure",
} as const;

/** Извлечь request id из запроса (или сгенерировать). */
export function requestIdFrom(req: Request): string {
  const existing =
    req.headers.get("x-request-id") ||
    req.headers.get("cf-ray") ||
    null;
  return existing || crypto.randomUUID();
}

export interface ServerCaptureOptions {
  component: DiagnosticComponent;
  severity?: Severity;
  errorCode?: string;
  route?: string;
  httpStatus?: number;
  requestId?: string;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
  /** Маскированный стек серверной ошибки (Error.stack). */
  stack?: string;
}

/**
 * Зарегистрировать серверную ошибку. НИКОГДА не бросает и не awaits.
 */
export function captureServerError(
  error: unknown,
  options: ServerCaptureOptions
): void {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(serializeUnknown(error));
  storeErrorEvent({
    component: options.component,
    severity: options.severity ?? "error",
    errorCode: options.errorCode ?? null,
    message: message || "unknown server error",
    route: options.route ?? null,
    httpStatus: options.httpStatus ?? null,
    stackTrace: error instanceof Error ? error.stack : null,
    requestId: options.requestId ?? null,
    actorId: options.actorId ?? null,
    source: "server",
    metadata: options.metadata,
  });
}

function serializeUnknown(value: unknown): unknown {
  try {
    return { kind: typeof value, value: String(value).slice(0, 200) };
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * Зарегистрировать ошибку тайм-аута/неожиданного ответа внешней
 * зависимости (infrastructure) — удобная обёртка.
 */
export function captureDependencyError(
  dependency: string,
  message: string,
  requestId?: string
): void {
  storeErrorEvent({
    component: "infrastructure",
    severity: "warning",
    errorCode: `dependency:${dependency}`,
    message,
    requestId,
    source: "server",
  });
}

// ===== Клиентская часть =====

/** Максимальный размер клиентского payload (байт) — DoS-гвард. */
export const CLIENT_PAYLOAD_MAX_BYTES = 16_000;
/** Ограничение на длину клиентского сообщения. */
export const CLIENT_MESSAGE_MAX = 400;

export interface ClientErrorPayload {
  component: string;
  message: string;
  errorCode?: string;
  route?: string;
  severity?: "error" | "warning";
  correlationId?: string;
  /** Стек НЕ передаётся на сервер (privacy) — только флаг наличия. */
  hasStack?: boolean;
  userAgentShort?: string;
}

/**
 * Собрать безопасный payload из клиентской ошибки (маскирование на
 * клиенте + повторное на сервере — defense-in-depth).
 */
export function buildClientPayload(
  error: unknown,
  extras: { route?: string; errorCode?: string; correlationId?: string } = {}
): ClientErrorPayload {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown client error";
  return {
    component: "frontend",
    message: message.slice(0, CLIENT_MESSAGE_MAX),
    errorCode: extras.errorCode,
    route: extras.route ?? (typeof window !== "undefined" ? window.location.pathname : undefined),
    severity: "error",
    correlationId: extras.correlationId,
    hasStack: error instanceof Error && Boolean(error.stack),
    userAgentShort:
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : undefined,
  };
}

/**
 * Неблокирующая отправка клиентской ошибки в ingest (§3.3).
 * Ошибки отправки полностью игнорируются (в т.ч. от самого ingest).
 */
export function reportClientError(
  error: unknown,
  extras: { route?: string; errorCode?: string; correlationId?: string } = {}
): void {
  if (typeof window === "undefined") return;
  try {
    const payload = buildClientPayload(error, extras);
    const body = JSON.stringify(payload);
    if (body.length > CLIENT_PAYLOAD_MAX_BYTES) return;
    void fetch("/api/diagnostics/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* сбой диагностики не влияет на клиента */
    });
  } catch {
    /* ignore */
  }
}
