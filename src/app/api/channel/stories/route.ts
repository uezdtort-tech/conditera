/**
 * GET  /api/channel/stories — список активных историй (expires_at > now)
 * POST /api/channel/stories — создать историю (TTL 24h). Только CONFECTIONER.
 *
 * Auth: GET public, POST CONFECTIONER
 *
 * Безопасность:
 *   • POST: требует роль CONFECTIONER.
 *   • POST: парсинг JSON безопасен (safeJsonBody), 400 при невалидном теле.
 *   • POST: валидируются типы полей (image/video — string, type — enum, duration — int).
 *   • POST: duration ограничен 1..60 секундами.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";
const STORY_TTL_HOURS = 24;
const MAX_CAPTION_LENGTH = 500;
const MIN_DURATION = 1;
const MAX_DURATION = 60;

const STORY_TYPES = ["image", "video"] as const;

interface CreateStoryBody {
  image?: string;
  video?: string;
  type?: string;
  caption?: string;
  duration?: number;
  productId?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams;
    const confectionerId = sp.get("confectionerId");
    const nowIso = new Date().toISOString();

    let query = supabaseAdmin
      .from("channel_stories")
      .select("*")
      .gt("expires_at", nowIso)
      .order("sort_order", { ascending: true })
      .limit(50);

    if (confectionerId) query = query.eq("confectioner_id", confectionerId);

    const { data, error } = await query;
    if (error) {
      console.warn("[channel/stories] GET error:", error.message);
    }

    return NextResponse.json({ stories: data || [] });
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

    const { data: body, error: parseErr } = await safeJsonBody<CreateStoryBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Валидация
    const image = typeof body.image === "string" ? body.image : "";
    const video = typeof body.video === "string" && body.video.length > 0 ? body.video : null;
    if (!image && !video) {
      throw new HttpError(400, "Нужно указать image или video URL");
    }

    const caption =
      typeof body.caption === "string"
        ? body.caption
        : null;
    if (caption && caption.length > MAX_CAPTION_LENGTH) {
      throw new HttpError(422, `caption слишком длинный (макс ${MAX_CAPTION_LENGTH} символов)`);
    }

    const typeResult = readEnumField(
      { type: body.type || (video ? "video" : "image") },
      "type",
      STORY_TYPES
    );
    if (typeResult.error || !typeResult.value) {
      throw new HttpError(422, typeResult.error || "type должен быть image или video");
    }
    const type = typeResult.value;

    let duration = 5;
    if (body.duration !== undefined) {
      if (typeof body.duration !== "number" || !Number.isInteger(body.duration)) {
        throw new HttpError(422, "duration должен быть целым числом");
      }
      if (body.duration < MIN_DURATION || body.duration > MAX_DURATION) {
        throw new HttpError(422, `duration должен быть в диапазоне ${MIN_DURATION}-${MAX_DURATION} секунд`);
      }
      duration = body.duration;
    }

    const productId = typeof body.productId === "string" ? body.productId : null;

    // Find confectioner profile
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (confErr) {
      console.error("[channel/stories] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось проверить профиль кондитера");
    }
    if (!conf) {
      throw new HttpError(404, "Профиль кондитера не найден");
    }

    const expiresAt = new Date(Date.now() + STORY_TTL_HOURS * 60 * 60 * 1000).toISOString();

    const { data: story, error } = await supabaseAdmin
      .from("channel_stories")
      .insert({
        confectioner_id: conf.id,
        image,
        video,
        type,
        caption,
        duration,
        product_id: productId,
        expires_at: expiresAt,
        views_count: 0,
        likes_count: 0,
        replies_count: 0,
        sort_order: 0,
      })
      .select()
      .single();

    if (error) {
      console.error("[channel/stories] insert failed:", error.message);
      throw new HttpError(500, "Не удалось создать историю");
    }

    return NextResponse.json({ story }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
