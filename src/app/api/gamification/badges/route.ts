/**
 * GET /api/gamification/badges
 *   Query: ?userId=... (по умолчанию текущий пользователь)
 *
 * Возвращает:
 *   - allBadges: все доступные бейджи
 *   - userBadges: полученные пользователем (с awarded_at)
 *   - stats: количество полученных / всего / редкость
 *
 * Безопасность:
 *   • GET: requires AUTHENTICATED.
 *   • При сбое БД — fallback на SYSTEM_BADGES (mock) с mock ids.
 *   • Type-safe interfaces для BadgeRow, UserBadgeRow.
 *   • Убраны `as any` касты.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface Badge {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  condition: Record<string, unknown>;
  reward_points: number;
  rarity: "common" | "rare" | "epic" | "legendary";
  active: boolean | null;
  created_at: string;
}

interface UserBadge {
  id: string;
  user_id: string;
  badge_id: string;
  awarded_at: string;
  badge?: Badge | null;
}

interface SystemBadge {
  code: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  condition: Record<string, unknown>;
  rewardPoints: number;
  rarity: "common" | "rare" | "epic" | "legendary";
}

// Системные бейджи (создаются при первом запуске или fallback)
const SYSTEM_BADGES: SystemBadge[] = [
  {
    code: "first_order",
    name: "Первый заказ",
    description: "Вы оформили свой первый заказ!",
    icon: "🎉",
    color: "#10b981",
    category: "orders",
    condition: { type: "orders_count", value: 1 },
    rewardPoints: 100,
    rarity: "common",
  },
  {
    code: "five_orders",
    name: "Опытный покупатель",
    description: "5 заказов на платформе",
    icon: "🏆",
    color: "#f59e0b",
    category: "orders",
    condition: { type: "orders_count", value: 5 },
    rewardPoints: 250,
    rarity: "rare",
  },
  {
    code: "ten_orders",
    name: "Постоянный клиент",
    description: "10 заказов — вы с нами надолго!",
    icon: "💎",
    color: "#7c3aed",
    category: "orders",
    condition: { type: "orders_count", value: 10 },
    rewardPoints: 500,
    rarity: "epic",
  },
  {
    code: "first_review",
    name: "Первый отзыв",
    description: "Поделились впечатлениями о заказе",
    icon: "✍️",
    color: "#3b82f6",
    category: "reviews",
    condition: { type: "reviews_count", value: 1 },
    rewardPoints: 50,
    rarity: "common",
  },
  {
    code: "five_reviews",
    name: "Активный рецензент",
    description: "5 отзывов — спасибо за обратную связь!",
    icon: "⭐",
    color: "#f59e0b",
    category: "reviews",
    condition: { type: "reviews_count", value: 5 },
    rewardPoints: 200,
    rarity: "rare",
  },
  {
    code: "five_star_review",
    name: "Восторг",
    description: "Поставили 5 звёзд в отзыве",
    icon: "🌟",
    color: "#fbbf24",
    category: "reviews",
    condition: { type: "five_star_reviews", value: 1 },
    rewardPoints: 100,
    rarity: "rare",
  },
  {
    code: "referral_first",
    name: "Привёл друга",
    description: "Первый приглашённый друг сделал заказ",
    icon: "🤝",
    color: "#10b981",
    category: "social",
    condition: { type: "referrals_count", value: 1 },
    rewardPoints: 300,
    rarity: "rare",
  },
  {
    code: "three_referrals",
    name: "Амбассадор",
    description: "3 приглашённых друга — вы помогаете расти!",
    icon: "👑",
    color: "#7c3aed",
    category: "social",
    condition: { type: "referrals_count", value: 3 },
    rewardPoints: 800,
    rarity: "epic",
  },
  {
    code: "big_spender_10k",
    name: "Гурман",
    description: "Потратили 10 000 ₽ на тортах",
    icon: "🍰",
    color: "#ec4899",
    category: "loyalty",
    condition: { type: "total_spent", value: 10000 },
    rewardPoints: 500,
    rarity: "epic",
  },
  {
    code: "big_spender_50k",
    name: "Сладкий король",
    description: "Потратили 50 000 ₽ — легендарно!",
    icon: "👑",
    color: "#fbbf24",
    category: "loyalty",
    condition: { type: "total_spent", value: 50000 },
    rewardPoints: 2000,
    rarity: "legendary",
  },
  {
    code: "streak_3_months",
    name: "Постоянство",
    description: "Заказывали 3 месяца подряд",
    icon: "🔥",
    color: "#ef4444",
    category: "special",
    condition: { type: "monthly_streak", value: 3 },
    rewardPoints: 600,
    rarity: "epic",
  },
  {
    code: "early_adopter",
    name: "Первопроходец",
    description: "Один из первых 1000 пользователей",
    icon: "🚀",
    color: "#7c3aed",
    category: "special",
    condition: { type: "early_adopter", value: 1000 },
    rewardPoints: 1000,
    rarity: "legendary",
  },
];

// Convert SystemBadge to Badge (для mock fallback)
function systemBadgeToBadge(b: SystemBadge, index: number): Badge {
  return {
    id: `mock-${index}`,
    code: b.code,
    name: b.name,
    description: b.description,
    icon: b.icon,
    color: b.color,
    category: b.category,
    condition: b.condition,
    reward_points: b.rewardPoints,
    rarity: b.rarity,
    active: true,
    created_at: new Date(0).toISOString(),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const userId = user.userId;
    const sp = request.nextUrl.searchParams;
    const requestedUserId = sp.get("userId") || userId;

    // Получаем все бейджи
    let allBadges: Badge[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("badges")
        .select("*")
        .eq("active", true)
        .order("rarity", { ascending: true })
        .order("created_at", { ascending: true }) as { data: Badge[] | null; error: SupabaseError | null };

      if (error) {
        console.warn("[gamification/badges] badges query failed:", error.message);
      }

      if (data && data.length > 0) {
        allBadges = data;
      } else {
        // Если БД пуста — fallback на системные бейджи
        allBadges = SYSTEM_BADGES.map(systemBadgeToBadge);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[gamification/badges] using system badges fallback:", msg);
      allBadges = SYSTEM_BADGES.map(systemBadgeToBadge);
    }

    // Получаем бейджи пользователя (с join к badges для данных бейджа)
    let userBadges: UserBadge[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("user_badges")
        .select(`
          id, user_id, badge_id, awarded_at,
          badges:badge_id (id, code, name, description, icon, color, category, condition, reward_points, rarity, active, created_at)
        `)
        .eq("user_id", requestedUserId)
        .order("awarded_at", { ascending: false }) as { data: UserBadge[] | null; error: SupabaseError | null };

      if (error) {
        console.warn("[gamification/badges] user_badges query failed:", error.message);
      }
      userBadges = data || [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[gamification/badges] using mock user_badges fallback:", msg);
      // Mock: 2 полученных бейджа (только если allBadges валиден)
      if (allBadges.length > 3) {
        userBadges = [
          {
            id: "mock-ub-0",
            user_id: requestedUserId,
            badge_id: allBadges[0].id,
            awarded_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            badge: allBadges[0],
          },
          {
            id: "mock-ub-3",
            user_id: requestedUserId,
            badge_id: allBadges[3].id,
            awarded_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            badge: allBadges[3],
          },
        ];
      }
    }

    // Статистика
    const userBadgeCodes = new Set(userBadges.map((ub) => ub.badge?.code).filter(Boolean) as string[]);
    const stats = {
      earned: userBadges.length,
      total: allBadges.length,
      percent: allBadges.length > 0 ? Math.round((userBadges.length / allBadges.length) * 100) : 0,
      byRarity: {
        common: userBadges.filter((ub) => ub.badge?.rarity === "common").length,
        rare: userBadges.filter((ub) => ub.badge?.rarity === "rare").length,
        epic: userBadges.filter((ub) => ub.badge?.rarity === "epic").length,
        legendary: userBadges.filter((ub) => ub.badge?.rarity === "legendary").length,
      },
    };

    // Группировка по категориям
    const byCategory: Record<string, Array<Badge & { earned: boolean; awardedAt?: string }>> = {};
    for (const badge of allBadges) {
      const cat = badge.category || "other";
      if (!byCategory[cat]) byCategory[cat] = [];
      const userBadge = userBadges.find((ub) => ub.badge?.code === badge.code);
      byCategory[cat].push({
        ...badge,
        earned: userBadgeCodes.has(badge.code),
        awardedAt: userBadge?.awarded_at,
      });
    }

    return NextResponse.json({
      allBadges,
      userBadges,
      byCategory,
      stats,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
