/**
 * events.ts — запись в append-only event log public.domain_events (Task 2-a).
 *
 * Контракт recordEvent:
 *   - fire-and-forget: НИКОГДА не роняет вызвавший запрос (try/catch + warn);
 *   - source по умолчанию 'app'; движок правил пишет source='engine'.
 *
 * Использование (после emitEvent из lib/n8n — рядом, см. точки врезки):
 *   void recordEvent("order.created", {
 *     entityType: "order", entityId: order.id, actorId: user.userId,
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
}

export async function recordEvent(
  type: string,
  opts: RecordEventOptions = {}
): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO public.domain_events (type, entity_type, entity_id, actor_id, payload, source)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        type,
        opts.entityType ?? null,
        opts.entityId ?? null,
        opts.actorId ?? null,
        JSON.stringify(opts.payload ?? {}),
        opts.source ?? "app",
      ]
    );
  } catch (err) {
    console.warn(
      `[ops/events] recordEvent(${type}) failed (ignored):`,
      err instanceof Error ? err.message : err
    );
  }
}
