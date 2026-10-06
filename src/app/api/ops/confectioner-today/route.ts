/**
 * GET /api/ops/confectioner-today — экран «Сегодня» кондитера (Task 2-a).
 *
 * Права: CONFECTIONER | ADMIN | SUPER_ADMIN. Данные всегда по user.id
 * (админ видит свои — обычно пустые — секции).
 *
 * Ответ:
 * {
 *   scannedAt,
 *   tasks: { critical, important, info, items: top-5 открытых своих задач },
 *   ordersToday:      [{ id, number, status, deliveryTime, total, itemsCount, productTitles }],
 *   inProduction:     [{ ... }],
 *   lowStock:         [{ id, name, quantity, minQuantity, unit }],
 *   purchaseDrafts:   [{ id, status, source, itemsCount, totalEstimated }],  // 7 дней
 *   revenueToday: number,
 *   messagesUnread: number
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { materializeOpsTasks, type OpsScanStats } from "@/lib/ops/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEVERITY_RANK = `CASE t.severity WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END`;

const ORDER_SHAPE = `o.id::text AS id, o.number, o.status::text AS status,
  o.delivery_time AS "deliveryTime", o.total,
  COALESCE(oi.items_count, 0) AS "itemsCount",
  COALESCE(oi.titles, '{}') AS "productTitles"`;

const ORDER_ITEMS_LATERAL = `LEFT JOIN LATERAL (
    SELECT count(*)::int AS items_count,
           array_agg(COALESCE(oi.product_title, oi.title))::text[] AS titles
    FROM public.order_items oi
    WHERE oi.order_id = o.id
  ) oi ON true`;

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
      { status: 401 }
    );
  }
  const guard = await requireAnyRole(user.id, [
    "CONFECTIONER",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (guard) return guard;

  const pool = getPool();
  const ownerId = user.id;

  // --- tasks (rule engine; падение движка не ломает экран) ---
  let stats: OpsScanStats | null = null;
  try {
    stats = await materializeOpsTasks(false);
  } catch (err) {
    console.warn(
      "[ops/confectioner-today] materializeOpsTasks failed:",
      err instanceof Error ? err.message : err
    );
  }

  const tasks = { critical: 0, important: 0, info: 0, items: [] as unknown[] };
  try {
    const countsRows = await pool.query<{ severity: string; c: number }>(
      `SELECT t.severity, count(*)::int AS c
       FROM public.ops_tasks t
       WHERE t.status = 'open' AND t.assignee_id = $1::uuid
       GROUP BY t.severity`,
      [ownerId]
    );
    for (const row of countsRows.rows) {
      tasks[row.severity as "critical" | "important" | "info"] = row.c;
    }

    const items = await pool.query(
      `SELECT t.id, t.type, t.severity, t.title, t.description, t.payload,
              t.action_label, t.action_url, t.status, t.created_at
       FROM public.ops_tasks t
       WHERE t.status = 'open' AND t.assignee_id = $1::uuid
       ORDER BY ${SEVERITY_RANK}, t.created_at DESC
       LIMIT 5`,
      [ownerId]
    );
    tasks.items = items.rows;
  } catch (err) {
    console.warn(
      "[ops/confectioner-today] tasks block failed:",
      err instanceof Error ? err.message : err
    );
  }

  // --- ordersToday + inProduction ---
  const orderShapeError = (label: string, err: unknown) =>
    console.warn(
      `[ops/confectioner-today] ${label} failed:`,
      err instanceof Error ? err.message : err
    );

  let ordersToday: unknown[] = [];
  try {
    const { rows } = await pool.query(
      `SELECT ${ORDER_SHAPE}
       FROM public.orders o ${ORDER_ITEMS_LATERAL}
       WHERE o.confectioner_id = $1::uuid
         AND o.delivery_date = CURRENT_DATE
         AND (o.is_draft IS NOT TRUE)
         AND o.status NOT IN ('CANCELLED', 'REFUNDED')
       ORDER BY o.delivery_time NULLS LAST`,
      [ownerId]
    );
    ordersToday = rows;
  } catch (err) {
    orderShapeError("ordersToday", err);
  }

  let inProduction: unknown[] = [];
  try {
    const { rows } = await pool.query(
      `SELECT ${ORDER_SHAPE}, o.delivery_date AS "deliveryDate"
       FROM public.orders o ${ORDER_ITEMS_LATERAL}
       WHERE o.confectioner_id = $1::uuid
         AND o.status IN ('CONFIRMED', 'PREPARING')
         AND o.delivery_date <= CURRENT_DATE + INTERVAL '3 days'
       ORDER BY o.delivery_date NULLS LAST, o.delivery_time NULLS LAST`,
      [ownerId]
    );
    inProduction = rows;
  } catch (err) {
    orderShapeError("inProduction", err);
  }

  // --- lowStock ---
  let lowStock: Array<Record<string, unknown>> = [];
  try {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      quantity: string;
      min_quantity: string;
      unit: string;
    }>(
      `SELECT id::text, name, quantity, min_quantity, unit
       FROM public.inventory_items
       WHERE owner_id = $1::uuid AND is_active AND quantity <= min_quantity
       ORDER BY (quantity / NULLIF(min_quantity, 0)) ASC, name`,
      [ownerId]
    );
    lowStock = rows.map((r) => ({
      id: r.id,
      name: r.name,
      quantity: Number(r.quantity),
      minQuantity: Number(r.min_quantity),
      unit: r.unit,
    }));
  } catch (err) {
    orderShapeError("lowStock", err);
  }

  // --- purchaseDrafts (7 дней) ---
  let purchaseDrafts: unknown[] = [];
  try {
    const { rows } = await pool.query(
      `SELECT d.id::text AS id, d.status, d.source,
              count(i.id)::int AS "itemsCount",
              COALESCE(sum(i.estimated_cost), 0)::int AS "totalEstimated"
       FROM public.purchase_drafts d
       LEFT JOIN public.purchase_draft_items i ON i.draft_id = d.id
       WHERE d.owner_id = $1::uuid AND d.created_at > now() - interval '7 days'
       GROUP BY d.id, d.status, d.source, d.created_at
       ORDER BY d.created_at DESC`,
      [ownerId]
    );
    purchaseDrafts = rows;
  } catch (err) {
    orderShapeError("purchaseDrafts", err);
  }

  // --- revenueToday ---
  let revenueToday = 0;
  try {
    const { rows } = await pool.query<{ c: number }>(
      `SELECT COALESCE(sum(total), 0)::int AS c
       FROM public.orders
       WHERE confectioner_id = $1::uuid AND paid_at::date = CURRENT_DATE`,
      [ownerId]
    );
    revenueToday = rows[0]?.c ?? 0;
  } catch (err) {
    orderShapeError("revenueToday", err);
  }

  // --- messagesUnread (упрощённо: сообщения за 24ч в каналах кондитера не от него) ---
  let messagesUnread = 0;
  try {
    const { rows } = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c
       FROM public.chat_messages m
       JOIN public.chat_channel_members cm
         ON cm.channel_id = m.channel_id AND cm.user_id = $1::uuid
       WHERE m.sender_id <> $1::uuid
         AND m.is_deleted = false
         AND m.created_at > now() - interval '24 hours'`,
      [ownerId]
    );
    messagesUnread = rows[0]?.c ?? 0;
  } catch (err) {
    orderShapeError("messagesUnread", err);
  }

  return NextResponse.json({
    scannedAt: stats?.scannedAt ?? null,
    tasks,
    ordersToday,
    inProduction,
    lowStock,
    purchaseDrafts,
    revenueToday,
    messagesUnread,
  });
}
