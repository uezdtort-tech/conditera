/**
 * POST /api/video-feed/[videoId]/like — лайк видео из вертикальной ленты.
 *
 * Фронтенд вызывает fire-and-forget (молча игнорирует ошибки), поэтому роут
 * спроектирован максимально устойчивым:
 *   • атомарный инкремент likesCount на уровне SQL (без read-modify-write гонок);
 *   • лёгкий in-memory троттлинг (1 лайк / IP / видео / час) против накрутки;
 *   • только активные видео участвуют (status='active').
 *
 * Публичный endpoint: авторизация не требуется (анонимные лайки),
 * ответ не содержит приватных данных.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/postgrest/pool";

export const runtime = "nodejs";

/** Окно троттлинга: 1 лайк на (IP, видео) в час */
const THROTTLE_WINDOW_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const recentLikes = new Map<string, number>();
let lastCleanupAt = Date.now();

function allowLike(ip: string, videoId: string): boolean {
  const now = Date.now();

  if (now - lastCleanupAt > CLEANUP_INTERVAL_MS) {
    for (const [key, ts] of recentLikes) {
      if (now - ts > THROTTLE_WINDOW_MS) recentLikes.delete(key);
    }
    lastCleanupAt = now;
  }

  const key = `${ip}:${videoId}`;
  const prev = recentLikes.get(key);
  if (prev !== undefined && now - prev < THROTTLE_WINDOW_MS) return false;

  recentLikes.set(key, now);
  return true;
}

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "anon";
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ videoId: string }> }
): Promise<NextResponse> {
  try {
    const { videoId } = await ctx.params;

    if (!videoId || typeof videoId !== "string" || videoId.length > 100) {
      return NextResponse.json({ error: "Некорректный id видео" }, { status: 400 });
    }

    const ip = clientIp(request);
    if (!allowLike(ip, videoId)) {
      return NextResponse.json(
        { error: "Слишком много лайков, попробуйте позже" },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }

    const pool = getPool();
    const result = await pool.query(
      `UPDATE "video_feed_items"
          SET "likesCount" = "likesCount" + 1
        WHERE "id" = $1 AND "status" = 'active'
        RETURNING "likesCount"`,
      [videoId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Видео не найдено" }, { status: 404 });
    }

    const likesCount = Number(result.rows[0]?.likesCount ?? 0);
    return NextResponse.json({ ok: true, likesCount });
  } catch (error) {
    // Fire-and-forget контракт: не шумим, но логируем для наблюдаемости
    console.warn("[video-feed/like] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Не удалось поставить лайк" }, { status: 500 });
  }
}
