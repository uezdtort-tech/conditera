/**
 * client-report.ts — ЧИСТО КЛИЕНТСКАЯ часть диагностики (DEPLOY-01 §3).
 *
 * Почему отдельный файл: error.tsx / global-error.tsx — клиентские
 * error-boundaries. Их бандл НЕ должен тянуть серверную цепочку
 * capture.ts → event-store.ts → postgrest/pool.ts (node:pg → node:dns —
 * Turbopack не может собрать это в браузер). Здесь только fetch-report
 * на /api/diagnostics/client-errors, НОЛЬ серверных импортов.
 */

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
