/**
 * rules.ts — rule engine очереди «Требуют действия» (Task 2-a).
 *
 * materializeOpsTasks() — идемпотентная материализация ops_tasks:
 *   1. каждая правило-функция выбирает «живые» условия SQL-ом и собирает кандидатов;
 *   2. кандидаты upsert'ятся по dedup_key (ON CONFLICT DO UPDATE):
 *      - status НЕ перезаписывается: ручные resolved/dismissed не переоткрываются;
 *      - авто-resolved задачи (resolve_comment LIKE 'auto:%') переоткрываются,
 *        если условие снова живо (счётчик reopened);
 *   3. исчезнувшие условия: engine-задачи этого типа со статусом open,
 *        чей dedup_key не в актуальном наборе, авто-resolve'ятся
 *        (resolve_comment='auto: condition cleared');
 *   4. каждая ВПЕРВЫЕ созданная задача пишет событие ops.task_created.
 *
 * Throttle: 45с in-memory (globalThis, паттерн pool.ts); force=true — игнорирует.
 * Каждое правило изолировано try/catch — падение одного не ломает скан.
 *
 * Отступление от ТЗ (задокументировано): payment_status НЕ содержит значения
 * 'paid' (enum 0001: pending|waiting_for_capture|succeeded|escrow|released|
 * cancelled|refunded) — «оплачен» = IN ('escrow','succeeded','released').
 */

import { type Pool } from "pg";
import { getPool } from "@/lib/postgrest/pool";
import { recordEvent } from "@/lib/ops/events";
import {
  computeRiskSnapshotsBulk,
  persistRiskLevels,
  emitRiskChanges,
  type OrderRiskSnapshot,
} from "@/lib/ops/risk-engine";
import { RISK_TASK_LEVELS, ESCALATION_CONFIG } from "@/lib/ops/lifecycle-config";
import { minuteToHHMM } from "@/lib/ops/deadline";

export interface OpsScanStats {
  created: number;
  reopened: number;
  resolved: number;
  scannedAt: string;
}

type Severity = "critical" | "important" | "info";
type AssigneeRole = "ADMIN" | "MODERATOR" | "CONFECTIONER";

interface TaskCandidate {
  dedup_key: string;
  type: string;
  severity: Severity;
  title: string;
  description?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  assignee_role?: AssigneeRole | null;
  assignee_id?: string | null;
  payload?: Record<string, unknown>;
  action_label?: string | null;
  action_url?: string | null;
}

// ---------------------------------------------------------------------------
// Throttle (globalThis, как pool.ts)
// ---------------------------------------------------------------------------

const THROTTLE_MS = 45_000;

const globalForScan = globalThis as unknown as {
  __conditeraOpsScanCache?: { at: number; stats: OpsScanStats };
  __conditeraOpsScanInflight?: Promise<OpsScanStats>;
};

export async function materializeOpsTasks(force = false): Promise<OpsScanStats> {
  const g = globalForScan;
  if (!force) {
    const cached = g.__conditeraOpsScanCache;
    if (cached && Date.now() - cached.at < THROTTLE_MS) return cached.stats;
    if (g.__conditeraOpsScanInflight) return g.__conditeraOpsScanInflight;
  }

  const p = runScan().then((stats) => {
    g.__conditeraOpsScanCache = { at: Date.now(), stats };
    return stats;
  });

  if (!force) {
    g.__conditeraOpsScanInflight = p;
    void p.catch(() => {}).finally(() => {
      g.__conditeraOpsScanInflight = undefined;
    });
  }
  return p;
}

async function runScan(): Promise<OpsScanStats> {
  const pool = getPool();
  let created = 0;
  let reopened = 0;
  let resolved = 0;

  const rules: Array<[string, (pool: Pool) => Promise<RuleStats>]> = [
    ["ORDER_UNASSIGNED", ruleOrderUnassigned],
    ["ORDER_OVERDUE", ruleOrderOverdue],
    ["MEDIA_PENDING", ruleMediaPending],
    ["LOW_STOCK", ruleLowStock],
    ["CHAT_UNANSWERED", ruleChatUnanswered],
    ["ORDER_REVIEW_REQUEST", ruleOrderReviewRequest],
    // P0.5:
    ["ORDER_AT_RISK", ruleOrderAtRisk],
    ["CONTACT_CUSTOMER", ruleContactCustomer],
    ["ORDER_PRODUCTION_DELAYED", ruleProductionDelayed],
  ];

  for (const [name, rule] of rules) {
    try {
      const stats = await rule(pool);
      created += stats.created;
      reopened += stats.reopened;
      resolved += stats.resolved;
    } catch (err) {
      console.warn(
        `[ops/rules] rule ${name} failed (skipped):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { created, reopened, resolved, scannedAt: new Date().toISOString() };
}

interface RuleStats {
  created: number;
  reopened: number;
  resolved: number;
}

// ---------------------------------------------------------------------------
// Материализация: upsert кандидатов + авто-resolve исчезнувших условий
// ---------------------------------------------------------------------------

const UPSERT_COLUMNS: Array<keyof TaskCandidate | "source"> = [
  "dedup_key",
  "type",
  "severity",
  "title",
  "description",
  "entity_type",
  "entity_id",
  "assignee_role",
  "assignee_id",
  "payload",
  "action_label",
  "action_url",
  "source",
];

async function upsertTasks(
  pool: Pool,
  candidates: TaskCandidate[]
): Promise<{ created: number; reopened: number }> {
  if (candidates.length === 0) return { created: 0, reopened: 0 };

  // Авто-resolved задачи среди кандидатов будут переоткрыты upsert'ом (CASE ниже)
  const keys = candidates.map((c) => c.dedup_key);
  const pre = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.ops_tasks
     WHERE dedup_key = ANY($1::text[]) AND status = 'resolved' AND resolve_comment LIKE 'auto:%'`,
    [keys]
  );
  const reopened = pre.rows[0]?.c ?? 0;

  // VALUES ($1..$13), ($14..$26), ...
  const NC = UPSERT_COLUMNS.length;
  const values: unknown[] = [];
  const placeholders = candidates
    .map((c, i) => {
      const row: string[] = [];
      UPSERT_COLUMNS.forEach((col, j) => {
        values.push(
          col === "payload"
            ? JSON.stringify(c.payload ?? {})
            : col === "source"
              ? "engine"
              : (c[col as keyof TaskCandidate] ?? null)
        );
        row.push(`$${i * NC + j + 1}`);
      });
      return `(${row.join(", ")})`;
    })
    .join(", ");

  const clearAutoResolution = `ops_tasks.status = 'resolved' AND ops_tasks.resolve_comment LIKE 'auto:%'`;

  const res = await pool.query(
    `INSERT INTO public.ops_tasks (${UPSERT_COLUMNS.join(", ")})
     VALUES ${placeholders}
     ON CONFLICT (dedup_key) DO UPDATE SET
       severity = EXCLUDED.severity,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       payload = EXCLUDED.payload,
       assignee_role = EXCLUDED.assignee_role,
       assignee_id = EXCLUDED.assignee_id,
       action_label = EXCLUDED.action_label,
       action_url = EXCLUDED.action_url,
       -- статус не трогаем, КРОМЕ переоткрытия авто-resolved (ручные resolved/dismissed живут)
       status = CASE WHEN ${clearAutoResolution} THEN 'open' ELSE ops_tasks.status END,
       resolved_at = CASE WHEN ${clearAutoResolution} THEN NULL ELSE ops_tasks.resolved_at END,
       resolved_by = CASE WHEN ${clearAutoResolution} THEN NULL ELSE ops_tasks.resolved_by END,
       resolve_comment = CASE WHEN ${clearAutoResolution} THEN NULL ELSE ops_tasks.resolve_comment END,
       updated_at = now()
     RETURNING id, type, severity, (xmax = 0) AS inserted`,
    values
  );

  let created = 0;
  for (const row of res.rows) {
    if (row.inserted) {
      created += 1;
      // Событие о новой задаче (fail-safe внутри recordEvent)
      await recordEvent("ops.task_created", {
        entityType: "ops_task",
        entityId: String(row.id),
        payload: { type: row.type, severity: row.severity },
        source: "engine",
      });
    }
  }
  return { created, reopened };
}

async function autoResolveCleared(
  pool: Pool,
  type: string,
  aliveKeys: string[]
): Promise<number> {
  const res = await pool.query(
    `UPDATE public.ops_tasks
     SET status = 'resolved', resolved_at = now(), resolve_comment = 'auto: condition cleared', updated_at = now()
     WHERE type = $1 AND source = 'engine' AND status = 'open'
       AND NOT (dedup_key = ANY($2::text[]))`,
    [type, aliveKeys]
  );
  return res.rowCount ?? 0;
}

async function materializeRule(
  pool: Pool,
  type: string,
  candidates: TaskCandidate[],
  extra?: (pool: Pool) => Promise<void>
): Promise<RuleStats> {
  const keys = candidates.map((c) => c.dedup_key);
  const upsert = await upsertTasks(pool, candidates);
  const resolved = await autoResolveCleared(pool, type, keys);
  if (extra) await extra(pool);
  return { created: upsert.created, reopened: upsert.reopened, resolved };
}

// ---------------------------------------------------------------------------
// Правило 1: ORDER_UNASSIGNED (ADMIN) — с эскалацией по SLA (ТЗ §24):
//   < 15 мин → info, 15–30 → important, ≥ 30 → critical,
//   ≥ 60 мин → событие order.unassigned_escalated (админ-эскалация).
// ---------------------------------------------------------------------------

type UnassignedRow = {
  id: string;
  number: string;
  total: number;
  delivery_date: string | null;
  paid_at: Date | null;
  created_at: Date;
};

async function ruleOrderUnassigned(pool: Pool): Promise<RuleStats> {
  const { rows } = await pool.query<UnassignedRow>(
    `SELECT id::text, number, total, delivery_date, paid_at, created_at
     FROM public.orders
     WHERE confectioner_id IS NULL
       AND payment_status::text IN ('escrow', 'succeeded', 'released')
       AND status NOT IN ('CANCELLED', 'REFUNDED')`
  );

  const now = Date.now();
  const escalatedIds: string[] = [];
  const candidates: TaskCandidate[] = rows.map((r) => {
    const ageMin = Math.floor(
      (now - (r.paid_at ? new Date(r.paid_at).getTime() : new Date(r.created_at).getTime())) / 60_000
    );
    const severity: Severity =
      ageMin >= ESCALATION_CONFIG.unassignedCriticalMinutes
        ? "critical"
        : ageMin >= ESCALATION_CONFIG.unassignedNotifyMinutes
          ? "important"
          : "info";
    if (ageMin >= ESCALATION_CONFIG.unassignedEscalationMinutes) escalatedIds.push(r.id);
    return {
      dedup_key: `ORDER_UNASSIGNED:${r.id}`,
      type: "ORDER_UNASSIGNED",
      severity,
      title: `Заказ #${r.number} не назначен кондитеру`,
      description:
        ageMin >= ESCALATION_CONFIG.unassignedCriticalMinutes
          ? `Оплата получена ${ageMin} мин назад — исполнитель не назначен (SLA нарушен).`
          : "Оплата получена, но исполнитель не назначен — назначьте кондитера.",
      entity_type: "order",
      entity_id: r.id,
      assignee_role: "ADMIN",
      assignee_id: null,
      payload: { total: r.total, deliveryDate: r.delivery_date, ageMinutes: ageMin },
      action_label: "Назначить кондитера",
      action_url: "/dashboard?tab=orders",
    };
  });

  const stats = await materializeRule(pool, "ORDER_UNASSIGNED", candidates);

  // Админ-эскалация (ТЗ §24): событие по возрасту ≥ 60 мин (dedup уровнем:
  // пишем только если задача ещё не critical — определяем по созданным/обновлённым)
  if (escalatedIds.length > 0) {
    const { rows: critRows } = await pool.query<{ entity_id: string }>(
      `SELECT entity_id FROM public.ops_tasks
       WHERE type='ORDER_UNASSIGNED' AND severity='critical' AND status='open'
         AND entity_id = ANY($1::text[])`,
      [escalatedIds]
    );
    const alreadyCritical = new Set(critRows.map((r) => r.entity_id));
    for (const id of escalatedIds) {
      if (alreadyCritical.has(id)) continue;
      await recordEvent("order.unassigned_escalated", {
        entityType: "order",
        entityId: id,
        payload: { minutes: ESCALATION_CONFIG.unassignedEscalationMinutes },
        source: "engine",
      });
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Правило 2: ORDER_OVERDUE (critical, ADMIN + дубль кондитеру)
// ---------------------------------------------------------------------------

async function ruleOrderOverdue(pool: Pool): Promise<RuleStats> {
  const { rows } = await pool.query<{
    id: string;
    number: string;
    confectioner_id: string | null;
    total: number;
    delivery_date: string | null;
  }>(
    `SELECT id::text, number, confectioner_id::text, total, delivery_date
     FROM public.orders
     WHERE delivery_date < CURRENT_DATE
       AND status NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED')`
  );

  const candidates: TaskCandidate[] = [];
  for (const r of rows) {
    const base = {
      type: "ORDER_OVERDUE" as const,
      severity: "critical" as const,
      entity_type: "order",
      entity_id: r.id,
      payload: { total: r.total, deliveryDate: r.delivery_date, orderNumber: r.number },
      action_label: "Открыть заказ",
      action_url: "/dashboard?tab=orders",
    };
    candidates.push({
      ...base,
      dedup_key: `ORDER_OVERDUE:${r.id}`,
      title: `Заказ #${r.number} просрочен`,
      description: `Дата доставки (${r.delivery_date ?? "?"}) уже прошла, заказ не завершён.`,
      assignee_role: "ADMIN",
      assignee_id: null,
    });
    if (r.confectioner_id) {
      candidates.push({
        ...base,
        dedup_key: `ORDER_OVERDUE:${r.id}:u${r.confectioner_id}`,
        title: `Заказ #${r.number} просрочен`,
        description: "Дата доставки прошла — обновите статус или согласуйте с клиентом.",
        assignee_role: "CONFECTIONER",
        assignee_id: r.confectioner_id,
      });
    }
  }

  return materializeRule(pool, "ORDER_OVERDUE", candidates);
}

// ---------------------------------------------------------------------------
// Правило 3: MEDIA_PENDING (important, MODERATOR) — агрегатная задача
// ---------------------------------------------------------------------------

async function ruleMediaPending(pool: Pool): Promise<RuleStats> {
  const { rows } = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.product_media WHERE status = 'pending'`
  );
  const count = rows[0]?.c ?? 0;

  const candidates: TaskCandidate[] =
    count > 0
      ? [
          {
            dedup_key: "MEDIA_PENDING:aggregate",
            type: "MEDIA_PENDING",
            severity: "important",
            title: "Товарные медиа ждут модерации",
            description: `В очереди модерации ${count} медиафайл(ов).`,
            entity_type: "product_media",
            entity_id: null,
            assignee_role: "MODERATOR",
            assignee_id: null,
            payload: { count },
            action_label: "Модерировать",
            action_url: "/dashboard?tab=media-moderation",
          },
        ]
      : [];

  return materializeRule(pool, "MEDIA_PENDING", candidates);
}

// ---------------------------------------------------------------------------
// Правило 4: LOW_STOCK (important, CONFECTIONER) + авточерновик закупки
// ---------------------------------------------------------------------------

async function ruleLowStock(pool: Pool): Promise<RuleStats> {
  const { rows } = await pool.query<{
    id: string;
    owner_id: string;
    name: string;
    quantity: string;
    min_quantity: string;
    unit: string;
    cost_per_unit: number | null;
    supplier: string | null;
  }>(
    `SELECT id::text, owner_id::text, name, quantity, min_quantity, unit, cost_per_unit, supplier
     FROM public.inventory_items
     WHERE is_active AND quantity <= min_quantity`
  );

  const candidates: TaskCandidate[] = rows.map((r) => ({
    dedup_key: `LOW_STOCK:${r.id}`,
    type: "LOW_STOCK",
    severity: "important",
    title: `Заканчивается: ${r.name}`,
    description: `Остаток ${Number(r.quantity)} ${r.unit} при минимуме ${Number(r.min_quantity)} ${r.unit}.`,
    entity_type: "inventory_item",
    entity_id: r.id,
    assignee_role: "CONFECTIONER",
    assignee_id: r.owner_id,
    payload: { quantity: Number(r.quantity), minQuantity: Number(r.min_quantity), unit: r.unit },
    action_label: "Создать закупку",
    action_url: "/dashboard?tab=today",
  }));

  return materializeRule(pool, "LOW_STOCK", candidates, async () => {
    await upsertPurchaseDrafts(pool, rows);
  });
}

/**
 * Автологика закупок: на владельца — один черновик source='low_stock_auto'
 * за последние 24ч (или новый), items upsert по (draft_id, inventory_item_id).
 * quantity = max(min*2 - текущий_остаток, min); estimated_cost = cost_per_unit * ceil(quantity).
 */
async function upsertPurchaseDrafts(
  pool: Pool,
  items: Array<{
    id: string;
    owner_id: string;
    name: string;
    quantity: string;
    min_quantity: string;
    unit: string;
    cost_per_unit: number | null;
    supplier: string | null;
  }>
): Promise<void> {
  if (items.length === 0) return;
  const ownerIds = [...new Set(items.map((i) => i.owner_id))];

  for (const ownerId of ownerIds) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id::text FROM public.purchase_drafts
       WHERE owner_id = $1::uuid AND source = 'low_stock_auto' AND status = 'draft'
         AND updated_at > now() - interval '24 hours'
       ORDER BY created_at DESC LIMIT 1`,
      [ownerId]
    );
    let draftId = existing.rows[0]?.id as string | undefined;
    if (!draftId) {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO public.purchase_drafts (owner_id, status, source, note)
         VALUES ($1::uuid, 'draft', 'low_stock_auto', 'Автоматически собрано: низкие остатки на складе')
         RETURNING id::text`,
        [ownerId]
      );
      draftId = ins.rows[0]?.id;
    }
    if (!draftId) continue;

    for (const it of items.filter((i) => i.owner_id === ownerId)) {
      const qty = Number(it.quantity);
      const min = Number(it.min_quantity);
      const need = Math.max(min * 2 - qty, min);
      const estimated =
        it.cost_per_unit && it.cost_per_unit > 0
          ? Math.round(it.cost_per_unit * Math.ceil(need))
          : null;

      const upd = await pool.query(
        `UPDATE public.purchase_draft_items
         SET quantity = $3, unit = $4, estimated_cost = $5, supplier = $6
         WHERE draft_id = $1::uuid AND inventory_item_id = $2::uuid`,
        [draftId, it.id, need, it.unit, estimated, it.supplier]
      );
      if ((upd.rowCount ?? 0) === 0) {
        await pool.query(
          `INSERT INTO public.purchase_draft_items
             (draft_id, inventory_item_id, name, quantity, unit, estimated_cost, supplier)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
          [draftId, it.id, it.name, need, it.unit, estimated, it.supplier]
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Правило 5: CHAT_UNANSWERED (important) — чаты заказов + support-каналы
// ---------------------------------------------------------------------------

async function ruleChatUnanswered(pool: Pool): Promise<RuleStats> {
  // 5a. Каналы с order_id: последнее сообщение — не от кондитера и старше 30 минут
  const { rows } = await pool.query<{
    channel_id: string;
    number: string;
    confectioner_id: string;
  }>(
    `SELECT c.id::text AS channel_id, o.number, o.confectioner_id::text
     FROM public.chat_channels c
     JOIN public.orders o ON o.id = c.order_id
     JOIN LATERAL (
       SELECT sender_id, created_at
       FROM public.chat_messages
       WHERE channel_id = c.id AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1
     ) m ON true
     WHERE o.confectioner_id IS NOT NULL
       AND o.status NOT IN ('CANCELLED', 'REFUNDED')
       AND m.sender_id <> o.confectioner_id
       AND m.created_at < now() - interval '30 minutes'`
  );

  const candidates: TaskCandidate[] = rows.map((r) => ({
    dedup_key: `CHAT_UNANSWERED:${r.channel_id}`,
    type: "CHAT_UNANSWERED",
    severity: "important",
    title: `Клиент ждёт ответа по заказу #${r.number}`,
    description: "Последнее сообщение в чате заказа — от клиента (более 30 минут назад).",
    entity_type: "chat_channel",
    entity_id: r.channel_id,
    assignee_role: "CONFECTIONER",
    assignee_id: r.confectioner_id,
    payload: { orderNumber: r.number },
    action_label: "Открыть чат",
    action_url: "/dashboard?tab=orders",
  }));

  // 5b. Support-каналы: last_message_at старше 30 минут → задача админу
  const sup = await pool.query<{ channel_id: string }>(
    `SELECT id::text AS channel_id
     FROM public.chat_channels
     WHERE type = 'support' AND deleted_at IS NULL
       AND last_message_at IS NOT NULL
       AND last_message_at < now() - interval '30 minutes'`
  );

  for (const s of sup.rows) {
    candidates.push({
      dedup_key: `CHAT_UNANSWERED:support:${s.channel_id}`,
      type: "CHAT_UNANSWERED",
      severity: "important",
      title: "Обращение в поддержку без ответа",
      description: "В support-канале нет ответа более 30 минут.",
      entity_type: "chat_channel",
      entity_id: s.channel_id,
      assignee_role: "ADMIN",
      assignee_id: null,
      payload: { channelId: s.channel_id },
      action_label: "Открыть тикеты",
      action_url: "/dashboard?tab=crm-tickets",
    });
  }

  return materializeRule(pool, "CHAT_UNANSWERED", candidates);
}

// ---------------------------------------------------------------------------
// Правило 6: ORDER_REVIEW_REQUEST (info, CONFECTIONER)
// ---------------------------------------------------------------------------

async function ruleOrderReviewRequest(pool: Pool): Promise<RuleStats> {
  const { rows } = await pool.query<{
    id: string;
    number: string;
    confectioner_id: string;
    product_id: string | null;
  }>(
    `SELECT o.id::text, o.number, o.confectioner_id::text,
            (SELECT oi.product_id::text
             FROM public.order_items oi
             WHERE oi.order_id = o.id AND oi.product_id IS NOT NULL
             LIMIT 1) AS product_id
     FROM public.orders o
     WHERE o.status = 'COMPLETED'
       AND o.completed_at IS NOT NULL
       AND o.completed_at > now() - interval '2 days'
       AND o.confectioner_id IS NOT NULL`
  );

  const candidates: TaskCandidate[] = rows.map((r) => ({
    dedup_key: `ORDER_REVIEW_REQUEST:${r.id}`,
    type: "ORDER_REVIEW_REQUEST",
    severity: "info",
    title: `Запросите отзыв по заказу #${r.number}`,
    description: "Заказ завершён — попросите клиента оставить отзыв о товаре.",
    entity_type: "order",
    entity_id: r.id,
    assignee_role: "CONFECTIONER",
    assignee_id: r.confectioner_id,
    payload: { productId: r.product_id, orderNumber: r.number },
    action_label: "Открыть отзывы",
    action_url: "/dashboard?tab=reviews-cf",
  }));

  return materializeRule(pool, "ORDER_REVIEW_REQUEST", candidates);
}

// ===========================================================================
// P0.5: Risk / Escalation rules (ТЗ §8, §12, §13, §23, §24)
// ===========================================================================

/**
 * Правило 7: ORDER_AT_RISK (ТЗ §13) — риск ORANGE/RED → задача кондитеру
 * (и админу для RED). Авто-resolve при возврате риска в GREEN/YELLOW
 * (материализация по dedup_key: исчезнувшие условия закрываются).
 * Риск пересчитывается здесь же (bulk, один SQL) и пишется в order_production.
 */
async function ruleOrderAtRisk(pool: Pool): Promise<RuleStats> {
  const snapshots = await computeRiskSnapshotsBulk(3);
  await persistRiskLevels(
    snapshots.map((s) => ({
      orderId: s.orderId,
      level: s.risk.level,
      reasons: s.risk.reasons,
    }))
  );
  await emitRiskChanges(snapshots);

  const candidates: TaskCandidate[] = [];
  for (const s of snapshots) {
    if (!RISK_TASK_LEVELS.has(s.risk.level)) continue;
    // Не оплаченные заказы не эскалируем (нет обязательств)
    if (!["escrow", "succeeded", "released"].includes(s.paymentStatus)) continue;
    // ORDER_AT_RISK — про НАРУШЕНИЕ ПЛАНА ДО производства (ТЗ §13: пример —
    // производство не начато). После старта производства сроки контролируют
    // ORDER_PRODUCTION_DELAYED / ORDER_OVERDUE — иначе задача не закрывается.
    const productionNotStarted =
      !s.startedAt && ["PENDING", "NEGOTIATING", "CONFIRMED"].includes(s.status);
    if (!productionNotStarted) continue;
    // Срочность: RED (план уже нарушен) ИЛИ безопасный старт в пределах
    // deadlineApproachingMinutes (ТЗ §24). Остальные сигналы (например,
    // CAPACITY_NOT_RESERVED) видны в Control Tower/lifecycle, но не спамят
    // общую очередь — legacy-заказы без плана не должны заливать её.
    const latest = s.production.latestSafeStartAt;
    const urgent =
      s.risk.level === "RED" ||
      (latest !== null &&
        latest.getTime() - Date.now() <=
          ESCALATION_CONFIG.deadlineApproachingMinutes * 60_000);
    if (!urgent) continue;

    const severity: Severity = s.risk.level === "RED" ? "critical" : "important";
    const reasonText = s.risk.details.join("; ");
    const nextStart =
      s.production.latestSafeStartAt instanceof Date
        ? s.production.latestSafeStartAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
        : null;

    const base = {
      type: "ORDER_AT_RISK" as const,
      severity,
      entity_type: "order" as const,
      entity_id: s.orderId,
      payload: {
        orderNumber: s.orderNumber,
        riskLevel: s.risk.level,
        reasons: s.risk.reasons,
        details: s.risk.details,
        deliveryDate: s.deliveryDate,
        latestSafeStartAt: s.production.latestSafeStartAt
          ? s.production.latestSafeStartAt.toISOString()
          : null,
      },
      action_label: "Открыть заказ",
      action_url: "/dashboard?tab=orders",
    };

    candidates.push({
      ...base,
      dedup_key: `ORDER_AT_RISK:${s.orderId}`,
      title: `Заказ #${s.orderNumber} под риском (${s.risk.level})`,
      description: `${reasonText}${nextStart ? ` Последний безопасный старт: ${nextStart}.` : ""}`,
      assignee_role: "ADMIN",
      assignee_id: null,
    });

    if (s.confectionerId) {
      candidates.push({
        ...base,
        dedup_key: `ORDER_AT_RISK:${s.orderId}:u${s.confectionerId}`,
        title: `Заказ #${s.orderNumber} под риском (${s.risk.level})`,
        description: `${reasonText}${nextStart ? ` Последний безопасный старт: ${nextStart}.` : ""}`,
        assignee_role: "CONFECTIONER",
        assignee_id: s.confectionerId,
      });
    }
  }

  return materializeRule(pool, "ORDER_AT_RISK", candidates);
}

/**
 * Правило 8: CONTACT_CUSTOMER (ТЗ §23) — RED-заказы требуют связи с клиентом:
 * «Заказ №N может быть готов позже» + оператор решает (связаться / перенести
 * окно / переназначить / отменить). AI не используется (ТЗ §54).
 */
async function ruleContactCustomer(pool: Pool): Promise<RuleStats> {
  const snapshots = await computeRiskSnapshotsBulk(3);
  const red = snapshots.filter(
    (s) => s.risk.level === "RED" && ["escrow", "succeeded", "released"].includes(s.paymentStatus)
  );

  const candidates: TaskCandidate[] = red.map((s) => ({
    dedup_key: `CONTACT_CUSTOMER:${s.orderId}`,
    type: "CONTACT_CUSTOMER",
    severity: "important" as const,
    title: `Свяжитесь с клиентом по заказу #${s.orderNumber}`,
    description: `Заказ под риском (${s.risk.details.join("; ")}). Сообщите клиенту о возможной задержке или согласуйте новый слот.`,
    entity_type: "order",
    entity_id: s.orderId,
    assignee_role: "ADMIN" as const,
    assignee_id: null,
    payload: {
      orderNumber: s.orderNumber,
      riskLevel: s.risk.level,
      reasons: s.risk.reasons,
      deliveryDate: s.deliveryDate,
      suggestedMessage: `Заказ №${s.orderNumber} может быть готов позже. Мы свяжемся с вами, как только уточним время.`,
    },
    action_label: "Связаться с клиентом",
    action_url: "/dashboard?tab=orders",
  }));

  return materializeRule(pool, "CONTACT_CUSTOMER", candidates);
}

/**
 * Правило 9: ORDER_PRODUCTION_DELAYED (ТЗ §24) — производство не начато,
 * хотя безопасное время старта прошло. Auto-resolve при старте производства.
 */
async function ruleProductionDelayed(pool: Pool): Promise<RuleStats> {
  const { rows } = await pool.query<{
    order_id: string;
    number: string;
    confectioner_id: string | null;
    latest_safe_start_at: Date | null;
    started_at: Date | null;
    estimated_minutes: number | null;
    planned_date: string | null;
    planned_start_minute: number | null;
  }>(
    `SELECT o.id::text AS order_id, o.number, o.confectioner_id::text,
            p.latest_safe_start_at, p.started_at, p.estimated_minutes,
            to_char(p.planned_date, 'YYYY-MM-DD') AS planned_date,
            p.planned_start_minute
     FROM public.orders o
     JOIN public.order_production p ON p.order_id = o.id
     WHERE o.status::text IN ('CONFIRMED', 'PREPARING')
       AND p.started_at IS NULL
       AND p.latest_safe_start_at IS NOT NULL
       AND p.latest_safe_start_at < now() - ($1::int * interval '1 minute')`,
    [ESCALATION_CONFIG.productionStartMissedMinutes]
  );

  const candidates: TaskCandidate[] = rows.map((r) => {
    const planned =
      r.planned_date && r.planned_start_minute !== null
        ? `${r.planned_date} ${minuteToHHMM(r.planned_start_minute)}`
        : null;
    return {
      dedup_key: `ORDER_PRODUCTION_DELAYED:${r.order_id}`,
      type: "ORDER_PRODUCTION_DELAYED",
      severity: "important" as const,
      title: `Производство заказа #${r.number} не начато`,
      description: `Безопасное время старта прошло${planned ? ` (план: ${planned})` : ""}. Начните производство или переназначьте исполнителя.`,
      entity_type: "order",
      entity_id: r.order_id,
      assignee_role: r.confectioner_id ? ("CONFECTIONER" as const) : ("ADMIN" as const),
      assignee_id: r.confectioner_id,
      payload: {
        orderNumber: r.number,
        latestSafeStartAt: r.latest_safe_start_at
          ? new Date(r.latest_safe_start_at).toISOString()
          : null,
        estimatedMinutes: r.estimated_minutes,
      },
      action_label: "Начать производство",
      action_url: "/dashboard?tab=orders",
    };
  });

  return materializeRule(pool, "ORDER_PRODUCTION_DELAYED", candidates);
}
