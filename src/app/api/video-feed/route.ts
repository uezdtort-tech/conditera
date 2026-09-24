/**
 * GET /api/video-feed — лента вертикальных видео (TikTok-style)
 * POST /api/video-feed — загрузить видео (только кондитер)
 *
 * Безопасность:
 *   • GET: public endpoint, limit/offset валидируются.
 *   • POST: требует роль CONFECTIONER.
 *   • POST: safeJsonBody + валидация (videoUrl, title обязательны).
 *   • При сбое БД в GET — fallback на mock-данные (для dev/preview).
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

const MOCK_VIDEOS: VideoFeedItemRow[] = [
  {
    id: "v1",
    confectioner_id: "c0",
    video_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    poster_url: "https://images.unsplash.com/photo-1535254973040-607b474cb50d?w=400",
    title: "Создаю свадебный торт с сахарными цветами 🌸",
    description: "3-ярусный торт с ручной росписью. 12 часов работы в 60 секунд!",
    views_count: 1247,
    likes_count: 342,
    comments_count: 28,
    shares_count: 15,
    product_id: null,
    audio_title: "Оригинальный звук",
    rating: 50,
    status: "active",
    created_at: new Date().toISOString(),
  },
  {
    id: "v2",
    confectioner_id: "c1",
    video_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    poster_url: "https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=400",
    title: "Шоколадный торт с зеркальной глазурью ✨",
    description: "Зеркальная глазурь — это магия. Смотрите как получается идеальная поверхность!",
    views_count: 892,
    likes_count: 256,
    comments_count: 19,
    shares_count: 8,
    product_id: null,
    audio_title: "Оригинальный звук",
    rating: 50,
    status: "active",
    created_at: new Date().toISOString(),
  },
  {
    id: "v3",
    confectioner_id: "c2",
    video_url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    poster_url: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400",
    title: "Бенто-торт за 5 минут ⏱️",
    description: "Мини-торт для одного — быстро, красиво, вкусно!",
    views_count: 2156,
    likes_count: 587,
    comments_count: 42,
    shares_count: 31,
    product_id: null,
    audio_title: "Trending Audio",
    rating: 50,
    status: "active",
    created_at: new Date().toISOString(),
  },
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parsePositiveInt(request.nextUrl.searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);

    let videos: VideoFeedItemRow[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("video_feed_items")
        .select("*")
        .eq("status", "active")
        .order("rating", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1) as { data: VideoFeedItemRow[] | null; error: SupabaseError | null };

      if (error) throw error;
      videos = data || [];
    } catch (e) {
      // Mock-данные
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[video-feed] using mock data:", msg);
      videos = MOCK_VIDEOS.slice(offset, offset + limit);
    }

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
        confectioner_id: user.userId,
        video_url: body.videoUrl,
        poster_url: posterUrl,
        title: body.title,
        description,
        product_id: productId,
        audio_title: audioTitle,
        status: "active",
        rating: INITIAL_RATING,
        views_count: 0,
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        created_at: new Date().toISOString(),
      })
      .select()
      .single() as { data: VideoFeedItemRow | null; error: SupabaseError | null };

    if (insertErr || !video) {
      console.error("[video-feed] insert failed:", insertErr?.message);
      throw new HttpError(500, "Не удалось загрузить видео");
    }

    return NextResponse.json({ video }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
