/**
 * GET /api/ops/summary — сводка операционного центра для админа (Task 2-a).
 *
 * Права: ADMIN | SUPER_ADMIN (requireAnyRole, БД-гейт).
 *
 * Ответ:
 * {
 *   generatedAt,
 *   today: { orders, inProduction, deliveries, newCustomers, revenueToday, revenueMonth } | null,
 *   attention: { critical, important, info } | null,   // ops_tasks (open, видимые админу = все)
 *   system: { db: 'ok'|'fail', payments: {configured}, automation: {configured}, storage: 'ok'|'fail' }
 * }
 *
 * Fallback-безопасно: ошибка блока → null (system-флаги всегда заполняются).
 */

import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { isYookassaConfigured } from "@/lib/yookassa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TodayBlock {
  orders: number;
  inProduction: number;
  deliveries: number;
  newCustomers: number;
  revenueToday: number;
  revenueMonth: number;
}

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
      { status: 401 }
    );
  }
  const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
  if (guard) return guard;

  const pool = getPool();
  const errors: string[] = [];

  // --- today ---
  let today: TodayBlock | null = null;
  try {
    const { rows } = await pool.query<{
      orders: number;
      in_production: number;
      deliveries: number;
      new_customers: number;
      revenue_today: number;
      revenue_month: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM public.orders WHERE created_at::date = CURRENT_DATE) AS orders,
         (SELECT count(*)::int FROM public.orders WHERE status IN ('CONFIRMED', 'PREPARING')) AS in_production,
         (SELECT count(*)::int FROM public.orders
           WHERE status IN ('READY', 'IN_DELIVERY') OR delivery_date = CURRENT_DATE) AS deliveries,
         (SELECT count(*)::int FROM public.profiles WHERE created_at::date = CURRENT_DATE) AS new_customers,
         (SELECT COALESCE(sum(total), 0)::int FROM public.orders WHERE paid_at::date = CURRENT_DATE) AS revenue_today,
         (SELECT COALESCE(sum(total), 0)::int FROM public.orders
           WHERE paid_at >= date_trunc('month', CURRENT_DATE)) AS revenue_month`
    );
    const r = rows[0];
    today = {
      orders: r?.orders ?? 0,
      inProduction: r?.in_production ?? 0,
      deliveries: r?.deliveries ?? 0,
      newCustomers: r?.new_customers ?? 0,
      revenueToday: r?.revenue_today ?? 0,
      revenueMonth: r?.revenue_month ?? 0,
    };
  } catch (err) {
    errors.push("today");
    console.warn(
      "[ops/summary] today block failed:",
      err instanceof Error ? err.message : err
    );
  }

  // --- attention (открытые ops_tasks; для админа видимость = все) ---
  let attention: { critical: number; important: number; info: number } | null = null;
  try {
    const { rows } = await pool.query<{ severity: string; c: number }>(
      `SELECT severity, count(*)::int AS c
       FROM public.ops_tasks
       WHERE status = 'open'
       GROUP BY severity`
    );
    attention = { critical: 0, important: 0, info: 0 };
    for (const row of rows) {
      attention[row.severity as keyof typeof attention] = row.c;
    }
  } catch (err) {
    errors.push("attention");
    console.warn(
      "[ops/summary] attention block failed:",
      err instanceof Error ? err.message : err
    );
  }

  // --- system (безопасно по определению) ---
  let db: "ok" | "fail" = "fail";
  try {
    await pool.query("SELECT 1");
    db = "ok";
  } catch {
    db = "fail";
  }

  const storageDir = path.join(process.cwd(), "storage");
  const storage: "ok" | "fail" = existsSync(storageDir) ? "ok" : "fail";

  const n8nBase = (
    process.env.N8N_WEBHOOK_BASE_URL ||
    process.env.N8N_BASE_URL ||
    ""
  ).trim();

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    today,
    attention,
    system: {
      db,
      payments: { configured: isYookassaConfigured() },
      automation: { configured: n8nBase.length > 0 },
      storage,
    },
    ...(errors.length > 0 ? { errors } : {}),
  });
}
