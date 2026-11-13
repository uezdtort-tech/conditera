/**
 * GET /api/video-feed — лента вертикальных видео (TikTok-style)
 * POST /api/video-feed — загрузить видео (только кондитер)
 *
 * Безопасность:
 *   • GET: public endpoint, limit/offset валидируются.
 *   • POST: требует роль CONFECTIONER.
 *   • POST: safeJsonBody + валидация (videoUrl, title обязательны).
 *   • При сбое БД в GET — честный 503 с маскированным сообщением (handleRouteError);
 *     mock-лента НЕ подставляется НИКОГДА (ZV33-7b FIX 3 / ZV33-6 C-2 — сбой
 *     сервера не маскируется фейковым контентом).
 *   • Type-safe interfaces для всех данных.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface VideoFeedItemRow {
  id: string;
  confectioner_id: string;
  video_url: string;
  poster_url: string | null;
  title: string;
  description: string | null;
  views_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count: number | null;
  product_id: string | null;
  audio_title: string | null;
  rating: number | null;
  status: string;
  created_at: string;
}

/** Форма строки в БД — схема Prisma-стиля с camelCase-колонками (см. 0001_full_schema.sql). */
interface VideoFeedItemDbRow {
  id: string;
  confectionerId: string;
  videoUrl: string;
  posterUrl: string | null;
  title: string;
  description: string | null;
  viewsCount: number | null;
  likesCount: number | null;
  commentsCount: number | null;
  sharesCount: number | null;
  productId: string | null;
  audioTitle: string | null;
  rating: number | null;
  status: string;
  createdAt: string;
}

/** Маппинг строки БД (camelCase) → стабильный snake_case-контракт API. */
function toApiRow(r: VideoFeedItemDbRow): VideoFeedItemRow {
  return {
    id: r.id,
    confectioner_id: r.confectionerId,
    video_url: r.videoUrl,
    poster_url: r.posterUrl,
    title: r.title,
    description: r.description,
    views_count: r.viewsCount,
    likes_count: r.likesCount,
    comments_count: r.commentsCount,
    shares_count: r.sharesCount,
    product_id: r.productId,
    audio_title: r.audioTitle,
    rating: r.rating,
    status: r.status,
    created_at: r.createdAt,
  };
}

interface UploadVideoBody {
  videoUrl?: string;
  posterUrl?: string;
  title?: string;
  description?: string;
  productId?: string;
  audioTitle?: string;
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const MAX_TITLE_LENGTH = 200;
const MAX_DESC_LENGTH = 2000;
const INITIAL_RATING = 50;

function parsePositiveInt(value: string | null, defaultValue: number, max: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) return defaultValue;
  return Math.min(num, max);
}


export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parsePositiveInt(request.nextUrl.searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);

    // ZV33-7b FIX 3 (ZV33-6 C-2): БЕЗ mock-fallback. Ошибка БД → HttpError(503)
    // → handleRouteError вернёт маскированный 5xx; потребитель (video-feed.tsx)
    // просто оставляет пустое состояние при !res.ok. Фейковый контент никогда
    // не подменяет серверный сбой.
    const { data, error } = await supabaseAdmin
      .from("video_feed_items")
      .select("*")
      .eq("status", "active")
      .order("rating", { ascending: false })
      .order("createdAt", { ascending: false })
      .range(offset, offset + limit - 1) as { data: VideoFeedItemDbRow[] | null; error: SupabaseError | null };

    if (error) {
      console.error("[video-feed] GET query error:", error.message);
      throw new HttpError(503, "Видеолента временно недоступна, попробуйте позже");
    }
    const videos: VideoFeedItemRow[] = (data || []).map(toApiRow);

    return NextResponse.json({ videos, total: videos.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    if (!user.roles.includes("CONFECTIONER")) {
      throw new HttpError(403, "Только кондитер");
    }

    const { data: body, error: parseErr } = await safeJsonBody<UploadVideoBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Валидация обязательных полей
    if (typeof body.videoUrl !== "string" || body.videoUrl.trim().length === 0) {
      throw new HttpError(400, "videoUrl обязателен");
    }
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      throw new HttpError(400, "title обязателен");
    }
    if (body.title.length > MAX_TITLE_LENGTH) {
      throw new HttpError(422, `title слишком длинный (макс ${MAX_TITLE_LENGTH})`);
    }

    // Валидация description
    let description: string | null = null;
    if (typeof body.description === "string") {
      if (body.description.length > MAX_DESC_LENGTH) {
        throw new HttpError(422, `description слишком длинный (макс ${MAX_DESC_LENGTH})`);
      }
      description = body.description;
    }

    const posterUrl = typeof body.posterUrl === "string" ? body.posterUrl : null;
    const productId = typeof body.productId === "string" ? body.productId : null;
    const audioTitle = typeof body.audioTitle === "string" ? body.audioTitle : null;

    const { data: video, error: insertErr } = await supabaseAdmin
      .from("video_feed_items")
      .insert({
        confectionerId: user.userId,
        videoUrl: body.videoUrl,
        posterUrl: posterUrl,
        title: body.title,
        description,
        productId: productId,
        audioTitle: audioTitle,
        status: "active",
        rating: INITIAL_RATING,
        viewsCount: 0,
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        createdAt: new Date().toISOString(),
      })
      .select()
      .single() as { data: VideoFeedItemDbRow | null; error: SupabaseError | null };

    if (insertErr || !video) {
      console.error("[video-feed] insert failed:", insertErr?.message);
      throw new HttpError(500, "Не удалось загрузить видео");
    }

    return NextResponse.json({ video: video ? toApiRow(video) : null }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
