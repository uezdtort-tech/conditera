/**
 * GET /api/admin/fraud-monitor — список подозрительных пользователей и событий.
 *
 * Возвращает:
 *  - suspiciousUsers: массив пользователей с 5+ уникальными IP за 24 часа
 *  - topIps: топ-30 IP по числу действий за 24 часа
 *  - actionsStats: топ действий за 24 часа
 *  - recentEvents: последние 50 событий fraud_log
 *  - summary: агрегированные метрики
 *
 * Auth: только ADMIN / SUPER_ADMIN
 *
 * Соответствует таблицам:
 *  - fraud_log (или order_fraud_log) — события антифрод-системы
 *  - через @/lib/anti-fraud: listSuspiciousUsers
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { listSuspiciousUsers } from "@/lib/anti-fraud";

export const runtime = "nodejs";

const MAX_IPS_RETURN = 30;
const MAX_EVENTS_RETURN = 50;

interface FraudLogEntry {
  id: string;
  ip_hash: string;
  user_id: string | null;
  action: string;
  device_fp: string | null;
  created_at: string;
}

/**
 * GET /api/admin/fraud-monitor — получить сводный отчёт по антифрод-системе.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Проверка роли — ADMIN или SUPER_ADMIN
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Подозрительные пользователи (5+ IP за 24 часа)
    const suspiciousUsers = await listSuspiciousUsers(50);

    // 2. Получить все fraud_log события за 24 часа
    const { data: fraudLogs, error: logsErr } = await supabaseAdmin
      .from("fraud_log")
      .select("id, ip_hash, user_id, action, device_fp, created_at")
      .gte("created_at", dayAgoIso)
      .order("created_at", { ascending: false })
      .limit(MAX_EVENTS_RETURN * 5);  // больше данных для агрегации

    if (logsErr) {
      console.error("[admin/fraud-monitor] query error:", logsErr.message);
      return NextResponse.json(
        { error: "Database query failed", details: logsErr.message },
        { status: 500 }
      );
    }

    const logs = (fraudLogs || []) as unknown as FraudLogEntry[];

    // Агрегация по IP (top-30)
    const ipCountMap = new Map<string, number>();
    for (const log of logs) {
      if (!log.ip_hash) continue;
      ipCountMap.set(log.ip_hash, (ipCountMap.get(log.ip_hash) || 0) + 1);
    }
    const topIps = Array.from(ipCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_IPS_RETURN)
      .map(([ipHash, count]) => ({
        ipHash: ipHash.slice(0, 12) + "…",  // маска для UI
        count,
      }));

    // Агрегация по action
    const actionCountMap = new Map<string, number>();
    for (const log of logs) {
      if (!log.action) continue;
      actionCountMap.set(log.action, (actionCountMap.get(log.action) || 0) + 1);
    }
    const actionsStats = Array.from(actionCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([action, count]) => ({ action, count }));

    // Последние 50 events
    const recentEvents = logs.slice(0, MAX_EVENTS_RETURN).map((e) => ({
      id: e.id,
      ip_hash: (e.ip_hash || "").slice(0, 12) + "…",
      user_id: e.user_id,
      action: e.action,
      device_fp: e.device_fp,
      created_at: e.created_at,
    }));

    return NextResponse.json({
      suspiciousUsers,
      topIps,
      actionsStats,
      recentEvents,
      summary: {
        totalEvents24h: logs.length,
        suspiciousUsersCount: suspiciousUsers.length,
        uniqueIps24h: ipCountMap.size,
      },
    });
  } catch (error: any) {
    console.error("GET /api/admin/fraud-monitor error:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка", detail: error?.message },
      { status: 500 }
    );
  }
}
