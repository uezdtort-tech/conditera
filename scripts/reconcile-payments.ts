/**
 * reconcile-payments.ts — PAY-2 сверка: payments ↔ yookassa_refund_events ↔
 * refunds ↔ financial_ledger (docs/pay/PAY-2-DESIGN.md §5).
 *
 * Запуск:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54329/conditera \
 *     npx tsx scripts/reconcile-payments.ts
 *   (или DATABASE_URL из .env.local — читается при наличии)
 *
 * Проверки (exit 1 при расхождении):
 *   1. payments.refund_amount*100 == SUM(yookassa_refund_events.amount_kopecks)
 *      по каждому платежу (RPC 0039 — единственный писатель refund_amount).
 *   2. SUM(refunds.amount WHERE status='processed') == payments.refund_amount.
 *   3. Платежи succeeded без ledger-записи payment_succeeded (дрейф журнала;
 *      платежи до внедрения 0063 — легаси, перечисляются отдельно).
 *   4. Ledger refund_confirmed без события провайдера в yookassa_refund_events
 *      (подозрение на подделку журнала).
 *
 * Скрипт ТОЛЬКО читает — денежных изменений не делает.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

// .env.local (если есть) — как chat-server: без зависимости от dotenv.
// ВАЖНО: .env.local — ЛОКАЛЬНАЯ истина, перекрывает внешний DATABASE_URL
// (в песочнице shell может экспортировать 5432, а встроенный PG живёт на 54329).
let envDatabaseUrl: string | null = null;
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      const value = m[2].replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
      if (m[1] === "DATABASE_URL") envDatabaseUrl = value;
    }
  }
} catch {
  /* .env.local необязателен */
}

const DATABASE_URL =
  envDatabaseUrl || process.env.DATABASE_URL || "postgresql://postgres@127.0.0.1:54329/conditera";

interface Check {
  name: string;
  failed: number;
  detail: string[];
}

function report(check: Check): void {
  if (check.failed === 0) {
    console.log(`  ✅ ${check.name}`);
  } else {
    console.log(`  ❌ ${check.name} — расхождений: ${check.failed}`);
    for (const d of check.detail.slice(0, 10)) console.log(`     ${d}`);
    if (check.detail.length > 10) console.log(`     … и ещё ${check.detail.length - 10}`);
  }
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const checks: Check[] = [];
  const push = (name: string, failed: number, detail: string[]) =>
    checks.push({ name, failed, detail });

  // --- 1. refund_amount vs yookassa_refund_events ---
  try {
    const { rows } = await client.query(`
      SELECT p.id::text, p.refund_amount,
             COALESCE(SUM(e.amount_kopecks), 0) AS events_kop
      FROM public.payments p
      LEFT JOIN public.yookassa_refund_events e ON e.payment_id = p.id
      GROUP BY p.id, p.refund_amount
      HAVING (p.refund_amount IS NULL OR p.refund_amount = 0)
        AND COALESCE(SUM(e.amount_kopecks), 0) > 0
         OR (p.refund_amount IS NOT NULL AND p.refund_amount > 0
             AND ROUND(p.refund_amount * 100) <> COALESCE(SUM(e.amount_kopecks), 0))
    `);
    push(
      "1. payments.refund_amount == SUM(yookassa_refund_events) [RPC 0039 — единственный писатель]",
      rows.length,
      rows.map(
        (r: Record<string, unknown>) =>
          `payment=${r.id}: refund_amount=${Number(r.refund_amount) || 0}₽, events=${Number(r.events_kop) / 100}₽`
      )
    );
  } catch (e) {
    push("1. payments vs refund_events", -1, [(e as Error).message]);
  }

  // --- 2. refund_amount vs processed refunds ---
  try {
    const { rows } = await client.query(`
      SELECT p.id::text, p.refund_amount,
             COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'processed'), 0) AS processed_sum
      FROM public.payments p
      LEFT JOIN public.refunds r ON r.payment_id = p.id
      GROUP BY p.id, p.refund_amount
      HAVING (p.refund_amount IS NULL OR p.refund_amount = 0)
        AND COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'processed'), 0) > 0
         OR (p.refund_amount IS NOT NULL AND p.refund_amount > 0
             AND ROUND(p.refund_amount) <> COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'processed'), 0))
    `);
    push(
      "2. payments.refund_amount == SUM(refunds.status='processed')",
      rows.length,
      rows.map(
        (r: Record<string, unknown>) =>
          `payment=${r.id}: refund_amount=${Number(r.refund_amount) || 0}₽, processed=${Number(r.processed_sum)}₽`
      )
    );
  } catch (e) {
    push("2. payments vs refunds", -1, [(e as Error).message]);
  }

  // --- 3. succeeded-платежи без ledger payment_succeeded ---
  try {
    const { rows } = await client.query(`
      SELECT p.id::text, p.created_at
      FROM public.payments p
      WHERE p.status = 'succeeded'
        AND p.yookassa_payment_id IS NOT NULL
        AND p.yookassa_payment_id NOT LIKE 'mock_%'
        AND NOT EXISTS (
          SELECT 1 FROM public.financial_ledger l
          WHERE l.payment_id = p.id AND l.entry_type = 'payment_succeeded'
        )
    `);
    const legacy = rows.filter((r: Record<string, unknown>) =>
      new Date(String(r.created_at)) < new Date("2026-11-01T00:00:00Z")
    );
    push(
      "3. succeeded-платежи без ledger payment_succeeded (легаси до 0063 перечислены отдельно)",
      rows.length - legacy.length,
      rows.map((r: Record<string, unknown>) => `payment=${r.id} (created ${r.created_at})`)
    );
  } catch (e) {
    push("3. ledger payment_succeeded покрытие", -1, [(e as Error).message]);
  }

  // --- 4. ledger refund_confirmed без события провайдера ---
  try {
    const { rows } = await client.query(`
      SELECT l.id::text, l.metadata->>'provider_refund_id' AS provider_refund_id
      FROM public.financial_ledger l
      WHERE l.entry_type = 'refund_confirmed'
        AND l.metadata->>'provider' = 'yookassa'
        AND NOT EXISTS (
          SELECT 1 FROM public.yookassa_refund_events e
          WHERE e.refund_id = l.metadata->>'provider_refund_id'
        )
    `);
    push(
      "4. ledger refund_confirmed без события провайдера (подозрение на подделку)",
      rows.length,
      rows.map((r: Record<string, unknown>) => `ledger=${r.id}, provider_refund=${r.provider_refund_id}`)
    );
  } catch (e) {
    push("4. ledger refund_confirmed vs провайдер", -1, [(e as Error).message]);
  }

  console.log("\n=== PAY-2 сверка: payments / refunds / refund_events / financial_ledger ===");
  let failed = 0;
  for (const c of checks) {
    report(c);
    if (c.failed > 0) failed += 1;
  }
  console.log(
    failed === 0
      ? "\nИтог: СХОДИТСЯ — расхождений нет."
      : `\nИтог: ${failed} проверок с расхождениями — требуется разбор (скрипт только читает, деньги не менял).`
  );

  await client.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("reconcile-payments failed:", e);
  process.exit(1);
});
