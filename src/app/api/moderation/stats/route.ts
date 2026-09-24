/**
 * GET /api/moderation/stats — статистика модерации.
 *
 * Возвращает: количество элементов в очереди, обработанных за день,
 * % одобренных, % заблокированных, среднее время реакции.
 *
 * Auth: ADMIN, MODERATOR или SUPPORT
 *
 * Делегирует в @/lib/content-moderation: getModerationStats()
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getModerationStats } from "@/lib/content-moderation";

export const runtime = "nodejs";

/**
 * GET /api/moderation/stats — получить статистику модерации.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — ADMIN, MODERATOR или SUPPORT
    const guard = await requireAnyRole(user.id, ["ADMIN", "MODERATOR", "SUPPORT"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    try {
      const stats = await getModerationStats();
      return NextResponse.json(stats);
    } catch (e: any) {
      console.error("GET /api/moderation/stats getModerationStats error:", e?.message);
      // Возвращаем пустую структуру вместо 500, чтобы UI не падал
      return NextResponse.json({
        queueLength: 0,
        processedToday: 0,
        approvedPercent: 0,
        blockedPercent: 0,
        avgReactionTimeMs: 0,
        error: e?.message,
      });
    }
  } catch (error: any) {
    console.error("GET /api/moderation/stats error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
