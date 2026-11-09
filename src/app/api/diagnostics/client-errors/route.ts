/**
 * POST /api/diagnostics/client-errors — ingest клиентских ошибок
 * (DEPLOY-01 §3: Frontend → JS-исключения, ошибки рендеринга, сетевые).
 *
 * Безопасность (§3.2, §14):
 *   • CSRF-exempt (телеметрия, как webhook) — компенсирующие контроли:
 *     rate-limit по IP, жёсткая валидация, лимит размера payload,
 *     НЕТ стека от клиента, НЕТ cookies/заголовков в сохраняемых данных;
 *   • двойное маскирование: buildClientPayload (клиент) + scrub (сервер);
 *   • компонент фиксируется как 'frontend' — клиент не может подменить
 *     компонент/источник на серверный;
 *   • сообщение ограничено (CLIENT_MESSAGE_MAX), всё тело < 16KB;
 *   • ответ всегда 202/4xx — сбой ingest не влияет на приложение.
 *
 * Возвращает 202 Accepted (fire-and-forget контракт).
 */

import { NextRequest, NextResponse } from "next/server";
import { storeErrorEvent } from "@/lib/diagnostics/event-store";
import { maskString } from "@/lib/diagnostics/masking";
import { getClientIP, rateLimit } from "@/lib/rate-limit";
import { CLIENT_PAYLOAD_MAX_BYTES, CLIENT_MESSAGE_MAX } from "@/lib/diagnostics/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClientErrorBody {
  component?: unknown;
  message?: unknown;
  errorCode?: unknown;
  route?: unknown;
  severity?: unknown;
  correlationId?: unknown;
  hasStack?: unknown;
  userAgentShort?: unknown;
}

function isNonEmptyString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1) Size guard (DoS через логирование, §14)
    const raw = await request.text();
    if (!raw || raw.length === 0) {
      return NextResponse.json({ error: "Пустое тело" }, { status: 400 });
    }
    if (raw.length > CLIENT_PAYLOAD_MAX_BYTES) {
      return NextResponse.json({ error: "Payload слишком большой" }, { status: 413 });
    }

    // 2) Rate limit по IP
    const ip = getClientIP(request);
    const rl = await rateLimit({
      key: `diagnostics:client:${ip}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (!rl.success) {
      return NextResponse.json(
        { error: "Слишком много запросов" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    // 3) Валидация
    let body: ClientErrorBody;
    try {
      body = JSON.parse(raw) as ClientErrorBody;
    } catch {
      return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
    }

    if (!isNonEmptyString(body.message, CLIENT_MESSAGE_MAX)) {
      return NextResponse.json({ error: "message обязателен" }, { status: 400 });
    }
    // severity — только error|warning от клиента (critical/INFO — серверные)
    const severity =
      body.severity === "warning" ? ("warning" as const) : ("error" as const);

    const route =
      isNonEmptyString(body.route, 256) && body.route.startsWith("/")
        ? body.route
        : null;
    const correlationId = isNonEmptyString(body.correlationId, 128)
      ? body.correlationId
      : null;
    const errorCode = isNonEmptyString(body.errorCode, 64) ? body.errorCode : null;
    const userAgentShort = isNonEmptyString(body.userAgentShort, 120)
      ? body.userAgentShort
      : null;

    // 4) Хэш IP (без сохранения сырого IP — PII-минимизация)
    const ipHash = await hashIp(ip);

    // 5) Маскирование и запись (источник фиксируется сервером)
    const stored = storeErrorEvent({
      component: "frontend",
      severity,
      errorCode,
      message: body.message,
      route,
      source: "client",
      requestId: correlationId,
      metadata: userAgentShort
        ? { userAgentShort: maskString(userAgentShort, 120), ipHash }
        : { ipHash },
    });

    return NextResponse.json(
      { ok: true, fingerprint: stored.fingerprint },
      { status: 202 }
    );
  } catch {
    // Диагностика не должна создавать пользовательских ошибок (§3.3)
    return NextResponse.json({ ok: true }, { status: 202 });
  }
}

/** SHA-256 первые 16 hex — псевдонимизация IP для rate-limit корреляции. */
async function hashIp(ip: string): Promise<string> {
  try {
    const { createHash } = await import("crypto");
    return createHash("sha256")
      .update(`${ip}:${process.env.IP_HASH_SALT || "conditera"}`)
      .digest("hex")
      .slice(0, 16);
  } catch {
    return "unknown";
  }
}
