/**
 * financial-ledger.ts — PAY-2: идемпотентная запись в платформенный журнал
 * финансовых операций (public.financial_ledger, миграция 0063).
 *
 * Инварианты (docs/pay/PAY-2-DESIGN.md §3):
 *   • журнал НЕ двигает деньги — записи пишутся ТОЛЬКО после факта
 *     (провайдер принял / CAS применил / заявка создана);
 *   • дедуп по idempotency_key: повторная вставка (23505 по
 *     uq_financial_ledger_idem_key) — УСПЕХ, а не ошибка;
 *   • amount знаковый, РУБЛИ: +платёж платформе, −возврат клиенту;
 *   • fail-safe: журнал не должен ломать платёжный поток — ошибки пишутся
 *     в лог и проглатываются (recordFinancialEntrySafe); денежные маршруты
 *     вызывают только Safe-вариант.
 *
 * Режимы провайдера в metadata.provider:
 *   'yookassa' — реальный провайдер; 'db-only' — платёж без provider id
 *   (легаси/mock-dev: возврат фиксируется в БД без вызова провайдера).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type FinancialEntryType =
  | "payment_created"
  | "payment_succeeded"
  | "payment_canceled"
  | "refund_requested"
  | "refund_sent"
  | "refund_send_failed"
  | "refund_confirmed"
  | "adjustment";

export interface FinancialEntryInput {
  entryType: FinancialEntryType;
  /** Знаковое движение, РУБЛИ: +платёж платформе, −возврат клиенту. */
  amount: number;
  paymentId?: string | null;
  orderId?: string | null;
  refundId?: string | null;
  actorId?: string | null;
  /** Дедуп: повторная вставка с тем же ключом — no-op. */
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface FinancialEntryResult {
  ok: boolean;
  duplicate: boolean;
  id?: string;
  error?: string;
}

/**
 * Идемпотентная вставка записи журнала. 23505 (уникальный idempotency_key)
 * трактуется как дубликат → ok:true, duplicate:true (данные вставки не читаем —
 * гонка не важна, запись уже существует).
 */
export async function recordFinancialEntry(
  entry: FinancialEntryInput
): Promise<FinancialEntryResult> {
  if (!Number.isFinite(entry.amount)) {
    return { ok: false, duplicate: false, error: "amount не конечное число" };
  }
  const payload = {
    entry_type: entry.entryType,
    amount: entry.amount,
    currency: "RUB",
    payment_id: entry.paymentId ?? null,
    order_id: entry.orderId ?? null,
    refund_id: entry.refundId ?? null,
    actor_id: entry.actorId ?? null,
    idempotency_key: entry.idempotencyKey ?? null,
    metadata: entry.metadata ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from("financial_ledger")
    .insert(payload)
    .select("id")
    .single();

  if (!error && data) {
    return { ok: true, duplicate: false, id: (data as { id: string }).id };
  }

  const pgCode = (error as { code?: string } | null)?.code;
  if (pgCode === "23505") {
    return { ok: true, duplicate: true };
  }
  return { ok: false, duplicate: false, error: error?.message || "insert failed" };
}

/**
 * Fail-safe обёртка для платёжных маршрутов: ошибка журнала НЕ ломает
 * платёжный поток (только console.error — сверка найдёт дрейф).
 */
export async function recordFinancialEntrySafe(entry: FinancialEntryInput): Promise<void> {
  try {
    const res = await recordFinancialEntry(entry);
    if (!res.ok) {
      console.error(
        "[financial-ledger] запись не удалась (дрейф журнала):",
        res.error,
        entry.entryType,
        entry.idempotencyKey
      );
    }
  } catch (e) {
    console.error(
      "[financial-ledger] неожиданная ошибка записи:",
      e instanceof Error ? e.message : e,
      entry.entryType,
      entry.idempotencyKey
    );
  }
}
