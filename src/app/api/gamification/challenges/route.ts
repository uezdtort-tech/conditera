/**
 * GET /api/gamification/challenges — активные челленджи + прогресс пользователя
 *
 * Auth: AUTHENTICATED
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

const SYSTEM_CHALLENGES = [
  {
    code: "three_cakes_month",
    name: "Три торта в июле",
    description: "Закажите 3 торта в июле и получите 500 бонусов",
    icon: "🎂",
    color: "#ec4899",
    goalType: "orders_count",
    goalValue: 3,
    rewardPoints: 500,
    rewardType: "points",
    startsAt: new Date("2026-07-01"),
    endsAt: new Date("2026-07-31"),
    active: true,
  },
  {
    code: "summer_spender",
    name: "Летний гурман",
    description: "Потратьте 5000 ₽ за лето и получите скидку 10%",
    icon: "☀️",
    color: "#f59e0b",
    goalType: "orders_amount",
    goalValue: 5000,
    rewardPoints: 0,
    rewardType: "discount",
    rewardValue: 10,
    startsAt: new Date("2026-06-01"),
    endsAt: new Date("2026-08-31"),
    active: true,
  },
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    // Get user challenges from DB
    const { data: userChallenges, error } = await supabaseAdmin
      .from("user_challenges")
      .select("*")
      .eq("user_id", user.id);

    if (error) console.warn("[gamification/challenges] GET error:", error.message);

    const userChallengesMap = new Map((userChallenges || []).map((uc: any) => [uc.challenge_code, uc]));

    const challenges = SYSTEM_CHALLENGES.map((c) => {
      const userC = userChallengesMap.get(c.code);
      return {
        ...c,
        progress: userC?.progress || 0,
        completed: userC?.completed || false,
        claimed: userC?.claimed || false,
      };
    });

    return NextResponse.json({ challenges });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
