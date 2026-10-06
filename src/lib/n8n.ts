/**
 * n8n.ts — fail-safe эмиттер событий в n8n (fire-and-forget).
 *
 * Контракт:
 *  - базовый URL: N8N_WEBHOOK_BASE_URL || N8N_BASE_URL; не задан → no-op
 *    (лог «выключено» максимум один раз на процесс, без спама);
 *  - POST `${base}/conditera-${type}` с JSON {type, payload, occurredAt, source};
 *  - заголовок X-N8N-Secret если задан N8N_WEBHOOK_SECRET;
 *  - AbortController 3s; ловим ВСЁ — событие никогда не ломает основной путь
 *    (эмиттер вызывается после успешной записи в БД и не должен ронять роут).
 *  - при сбое доставки событие уходит в dead-letter (audit_log, действие
 *    "n8n.dead-letter") — потерянные события видны в админке, а не только
 *    в консоли. Сам dead-letter тоже fail-safe (double try/catch).
 *
 * Вызов на сайтах: `void emitEvent(...).catch(() => {})` — но функция async,
 * чтобы вызывающий МОГ дождаться в некритичных фоновых задачах.
 */

export type ConditeraEvent =
  | "order.created"
  | "order.paid"
  | "order.status_changed"
  | "order.cancelled"
  | "refund.created"
  | "refund.completed"
  | "chat.message.created"
  | "inventory.low"
  | "service.booking.created";

const globalForN8n = globalThis as unknown as {
  __conditeraN8nWarned?: boolean;
};

export async function emitEvent(
  type: ConditeraEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const base = (process.env.N8N_WEBHOOK_BASE_URL || process.env.N8N_BASE_URL || "").trim();

  if (!base) {
    // Fail-safe: n8n не сконфигурирован — событие молча теряется (лог 1 раз/процесс)
    if (!globalForN8n.__conditeraN8nWarned) {
      globalForN8n.__conditeraN8nWarned = true;
      console.info(
        "[n8n] emitEvent: N8N_WEBHOOK_BASE_URL/N8N_BASE_URL не заданы — события не отправляются (no-op)"
      );
    }
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await fetch(`${base.replace(/\/+$/, "")}/conditera-${type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_WEBHOOK_SECRET
          ? { "X-N8N-Secret": process.env.N8N_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        type,
        payload,
        occurredAt: new Date().toISOString(),
        source: "conditera",
      }),
      signal: controller.signal,
    });
  } catch (err) {
    // Никогда не бросаем: сбой n8n не должен влиять на бизнес-путь
    const msg = (err as Error)?.message || String(err);
    console.warn(`[n8n] emitEvent(${type}) failed (ignored):`, msg);
    await deadLetter(type, payload, msg);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dead-letter: недоставленное событие фиксируем в audit_log.
 * Динамический импорт — happy path не тянет зависимости, сбои глотаем.
 */
async function deadLetter(
  type: ConditeraEvent,
  payload: Record<string, unknown>,
  error: string
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    await supabaseAdmin.from("audit_log").insert({
      action: "n8n.dead-letter",
      entity_type: "event",
      entity_id: type,
      metadata: { type, payload, error, deadLetteredAt: new Date().toISOString() },
      created_at: new Date().toISOString(),
    });
  } catch (dlErr) {
    console.warn(
      "[n8n] dead-letter write failed (event lost):",
      (dlErr as Error)?.message
    );
  }
}
