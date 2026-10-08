/**
 * events.ts — запись в append-only event log public.domain_events (Task 2-a).
 *
 * Контракт recordEvent:
 *   - fire-and-forget: НИКОГДА не роняет вызвавший запрос (try/catch + warn);
 *   - source по умолчанию 'app'; движок правил пишет source='engine'.
 *   - P1.1: dedupKey — стабильный idempotency key события (миграция 0060,
 *     UNIQUE (dedup_key) WHERE dedup_key IS NOT NULL). Повторная обработка
 *     одного логического события (retry webhook, повторная эмиссия) НЕ
 *     создаёт вторую строку. Для статусных событий (order.status_changed и
 *     пр.) ключ НЕ передавать — они легитимно пишутся многократно.
 *
 * Использование (после emitEvent из lib/n8n — рядом, см. точки врезки):
 *   void recordEvent("order.created", {
 *     entityType: "order", entityId: order.id, actorId: user.userId,
 *     dedupKey: `order-created:${order.id}`,
 *     payload: { number: order.number, total: finalTotal },
 *   });
 */

import { getPool } from "@/lib/postgrest/pool";

export type DomainEventSource = "app" | "n8n" | "cron" | "engine";

export interface RecordEventOptions {
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  payload?: Record<string, unknown>;
  source?: DomainEventSource;
  /** P1.1: idempotency key — точечное событие пишется один раз (0060). */
  dedupKey?: string | null;
}

export async function recordEvent(
  type: string,
  opts: RecordEventOptions = {}
): Promise<void> {
  try {
    const pool = getPool();
    // ON CONFLICT с предикатом = арбитр частичного уникального индекса 0060.
    await pool.query(
      `INSERT INTO public.domain_events (type, entity_type, entity_id, actor_id, payload, source, dedup_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
      [
        type,
        opts.entityType ?? null,
        opts.entityId ?? null,
        opts.actorId ?? null,
        JSON.stringify(opts.payload ?? {}),
        opts.source ?? "app",
        opts.dedupKey ?? null,
      ]
    );
  } catch (err) {
    console.warn(
      `[ops/events] recordEvent(${type}) failed (ignored):`,
      err instanceof Error ? err.message : err
    );
  }
}
