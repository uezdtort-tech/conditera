/**
 * GET  /api/channel/posts — список публикаций (public, is_published=true)
 * POST /api/channel/posts — создать публикацию (CONFECTIONER)
 *
 * Auth: GET public, POST CONFECTIONER
 *
 * Безопасность:
 *   • GET: limit/offset валидируются (NaN/отрицательные → дефолт).
 *   • POST: требует роль CONFECTIONER.
 *   • POST: парсинг JSON безопасен (safeJsonBody), 400 при невалидном теле.
 *   • POST: content обязателен (1..10000 символов), images — массив до 10 URL.
 *   • POST: isPinned — boolean.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MAX_CONTENT_LENGTH = 10_000;
const MAX_IMAGES_COUNT = 10;

interface CreatePostBody {
  content?: string;
  images?: unknown;
  isPinned?: boolean;
}

function parsePositiveInt(value: string | null, defaultValue: number, max: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) return defaultValue;
  return Math.min(num, max);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const confectionerId = searchParams.get("confectionerId");
    const limit = parsePositiveInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parsePositiveInt(searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);

    let query = supabaseAdmin
      .from("channel_posts")
      .select("*", { count: "exact" })
      .eq("is_published", true)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (confectionerId) query = query.eq("confectioner_id", confectionerId);

    const { data: posts, count, error } = await query;
    if (error) {
      console.warn("[channel/posts] GET error:", error.message);
    }

    return NextResponse.json({ posts: posts || [], total: count || 0, limit, offset });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    // Find confectioner profile
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (confErr) {
      console.error("[channel/posts] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось проверить профиль кондитера");
    }
    if (!conf) {
      throw new HttpError(404, "Профиль кондитера не найден");
    }

    const { data: body, error: parseErr } = await safeJsonBody<CreatePostBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    const { content, images, isPinned } = body;

    if (typeof content !== "string" || content.trim().length === 0) {
      throw new HttpError(400, "Укажите content");
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new HttpError(422, `content слишком длинный (макс ${MAX_CONTENT_LENGTH} символов)`);
    }

    // Validate images
    let normalizedImages: string[] = [];
    if (images !== undefined && images !== null) {
      if (!Array.isArray(images)) {
        throw new HttpError(422, "images должен быть массивом");
      }
      if (images.length > MAX_IMAGES_COUNT) {
        throw new HttpError(422, `images: слишком много элементов (макс ${MAX_IMAGES_COUNT})`);
      }
      for (const img of images) {
        if (typeof img !== "string") {
          throw new HttpError(422, "images: каждый элемент должен быть строкой");
        }
      }
      normalizedImages = images as string[];
    }

    const { data: post, error } = await supabaseAdmin
      .from("channel_posts")
      .insert({
        confectioner_id: conf.id,
        content,
        images: normalizedImages,
        is_pinned: Boolean(isPinned),
        is_published: false, // Скрыт до модерации
        moderation_status: "pending", // Ожидает модерации администратора
        published_at: new Date().toISOString(),
        views_count: 0,
        likes_count: 0,
        comments_count: 0,
      })
      .select()
      .single();

    if (error) {
      console.error("[channel/posts] insert failed:", error.message);
      throw new HttpError(500, "Не удалось создать публикацию");
    }

    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
