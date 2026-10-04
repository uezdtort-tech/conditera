/**
 * POST /api/gamification/challenges/:id/claim — получить награду за завершённый челлендж.
 * Начисляет бонусные баллы на счёт пользователя.
 *
 * Auth: AUTHENTICATED
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: challengeId } = await params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const { data: userChallenge, error } = await supabaseAdmin
      .from("user_challenges")
      .select("*")
      .eq("user_id", user.id)
      .eq("challenge_id", challengeId)
      .maybeSingle();

    if (error || !userChallenge) {
      return NextResponse.json({ error: "Вы не участвуете в этом челлендже" }, { status: 400 });
    }
    if (!userChallenge.completed) {
      return NextResponse.json({ error: "Челлендж ещё не завершён" }, { status: 400 });
    }
    if (userChallenge.claimed) {
      return NextResponse.json({ error: "Награда уже получена" }, { status: 400 });
    }

    // Награда живёт в challenges.reward_value (user_challenges.reward_points не существует)
    const { data: challenge } = await supabaseAdmin
      .from("challenges")
      .select("reward_value, reward_type")
      .eq("id", challengeId)
      .maybeSingle();
    const rewardPoints = challenge?.reward_value ?? 100;

    // Mark as claimed (идемпотентность: условный update — гонка двух claim даёт 0 строк)
    const { data: claimedRows } = await supabaseAdmin
      .from("user_challenges")
      .update({ claimed: true, claimed_at: new Date().toISOString() })
      .eq("id", userChallenge.id)
      .eq("claimed", false)
      .select("id");
    if (!claimedRows || claimedRows.length === 0) {
      return NextResponse.json({ error: "Награда уже получена" }, { status: 400 });
    }

    // Award points (non-blocking)
    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("bonus_balance")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        await supabaseAdmin
          .from("profiles")
          .update({ bonus_balance: (profile.bonus_balance || 0) + rewardPoints })
          .eq("id", user.id);
      }
    } catch {}

    return NextResponse.json({
      success: true,
      challengeId,
      reward: { points: rewardPoints },
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Ошибка", detail: error?.message }, { status: 500 });
  }
}
