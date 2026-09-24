/**
 * GET /api/cron/expiring-bonuses — find users with bonus points expiring in 14 days
 *
 * Called by n8n daily at 09:00. Returns users whose EARN transactions have
 * expiresAt dates within the next 14 days, so we can send them a reminder
 * to use the points before they vanish.
 *
 * Auth: X-Cron-Secret header (CRON_SECRET env var)
 *
 * Соответствует таблицам:
 *  - loyalty_transactions (для транзакций с типом EARN)
 *  - profiles (для данных пользователя)
 *  - notification_preferences (для фильтра opt-out)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

interface ExpiringBonusUser {
  userId: string;
  userName: string | null;
  userEmail: string;
  currentBalance: number;
  points: number;
  expiresAt: string;
  daysLeft: number;
}

/**
 * GET /api/cron/expiring-bonuses — найти пользователей с истекающими бонусами.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 14);

    // Найти все EARN-транзакции, истекающие в течение 14 дней.
    // Колонка начисленных баллов — amount (миграция 0010); 'points' в схеме нет.
    const { data: expiring, error } = await supabaseAdmin
      .from("loyalty_transactions")
      .select("user_id, amount, expires_at")
      .eq("type", "EARN")
      .gt("amount", 0)
      .gt("expires_at", now.toISOString())
      .lte("expires_at", cutoff.toISOString())
      .order("expires_at", { ascending: true });

    if (error) {
      console.error("[cron/expiring-bonuses] query error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    // Агрегировать по user_id
    const byUser = new Map<string, { points: number; earliestExpiry: Date }>();
    for (const tx of expiring || []) {
      const userId = tx.user_id as string;
      const points = Number(tx.amount);
      const expiresAt = tx.expires_at ? new Date(tx.expires_at) : cutoff;

      const existing = byUser.get(userId);
      if (existing) {
        existing.points += points;
        if (expiresAt < existing.earliestExpiry) {
          existing.earliestExpiry = expiresAt;
        }
      } else {
        byUser.set(userId, { points, earliestExpiry: expiresAt });
      }
    }

    // Загрузить профиль + notification preferences для каждого пользователя
    const users: (ExpiringBonusUser | null)[] = await Promise.all(
      Array.from(byUser.entries()).map(async ([userId, info]) => {
        // Получить профиль пользователя
        const { data: profile, error: pErr } = await supabaseAdmin
          .from("profiles")
          .select("id, email, name, bonus_balance, is_blocked")
          .eq("id", userId)
          .maybeSingle();

        if (pErr || !profile) return null;
        if (profile.is_blocked) return null;

        // Получить notification preferences
        const { data: prefs } = await supabaseAdmin
          .from("notification_preferences")
          .select("promotions, email_enabled")
          .eq("user_id", userId)
          .maybeSingle();

        // Если пользователь отключил уведомления о промо/лояльности — пропускаем
        if (prefs && prefs.promotions === false) return null;

        return {
          userId: profile.id,
          userName: profile.name,
          userEmail: profile.email,
          currentBalance: Number(profile.bonus_balance) || 0,
          points: info.points,
          expiresAt: info.earliestExpiry.toISOString(),
          daysLeft: Math.ceil(
            (info.earliestExpiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
          ),
        };
      })
    );

    const validUsers = users.filter((u): u is ExpiringBonusUser => u !== null);
    const totalPoints = validUsers.reduce((sum, u) => sum + u.points, 0);

    return NextResponse.json({
      users: validUsers,
      total: validUsers.length,
      totalPoints,
      cutoff: cutoff.toISOString(),
    });
  } catch (error: any) {
    console.error("GET /api/cron/expiring-bonuses error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
