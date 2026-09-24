/**
 * GET  /api/lessons — список уроков (public, только published)
 * POST /api/lessons — создать урок (CONFECTIONER)
 *
 * Query: ?confectionerId=&type=&difficulty=&limit=
 *
 * Безопасность:
 *   • GET: limit валидируется (1-100, default 20).
 *   • POST: требует роль CONFECTIONER.
 *   • POST: парсинг JSON безопасен (safeJsonBody).
 *   • POST: type — enum, difficulty — enum, status — enum (draft|published).
 *   • POST: title обязателен (1..200 символов).
 *   • POST: price — неотрицательное число.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_DESC_LENGTH = 5000;
const MAX_PRICE = 100_000;
const MAX_DURATION = 600;

const LESSON_TYPES = ["video_lesson", "text_lesson", "live_workshop", "pre-recorded"] as const;
const DIFFICULTY_LEVELS = ["beginner", "intermediate", "advanced", "professional"] as const;
const LESSON_STATUSES = ["draft", "published", "archived"] as const;

interface CreateLessonBody {
  title?: string;
  description?: string;
  type?: string;
  difficultyLevel?: string;
  videoUrl?: string;
  durationMin?: number;
  price?: number;
  status?: string;
}

function parsePositiveInt(value: string | null, defaultValue: number, max: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1) return defaultValue;
  return Math.min(num, max);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams;
    const confectionerId = sp.get("confectionerId");
    const type = sp.get("type");
    const difficulty = sp.get("difficulty");
    const limit = parsePositiveInt(sp.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);

    let query = supabaseAdmin
      .from("confectioner_lessons")
      .select("*")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (confectionerId) query = query.eq("confectioner_id", confectionerId);
    if (type) query = query.eq("type", type);
    if (difficulty) query = query.eq("difficulty_level", difficulty);

    const { data, error } = await query;
    if (error) {
      console.warn("[lessons] GET error:", error.message);
    }
    return NextResponse.json({ lessons: data || [] });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const guard = await requireRole(user.userId, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    // Find confectioner
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (confErr) {
      console.error("[lessons] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось проверить профиль кондитера");
    }
    if (!conf) throw new HttpError(404, "Профиль кондитера не найден");

    const { data: body, error: parseErr } = await safeJsonBody<CreateLessonBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Validate title
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      throw new HttpError(400, "title обязателен");
    }
    if (body.title.length > MAX_TITLE_LENGTH) {
      throw new HttpError(422, `title слишком длинный (макс ${MAX_TITLE_LENGTH})`);
    }

    // Validate description
    let description: string | null = null;
    if (typeof body.description === "string") {
      if (body.description.length > MAX_DESC_LENGTH) {
        throw new HttpError(422, `description слишком длинный (макс ${MAX_DESC_LENGTH})`);
      }
      description = body.description;
    }

    // Validate type
    const typeResult = readEnumField(
      { type: body.type || "video_lesson" },
      "type",
      LESSON_TYPES
    );
    if (typeResult.error || !typeResult.value) {
      throw new HttpError(422, typeResult.error || `type должен быть одним из: ${LESSON_TYPES.join(", ")}`);
    }

    // Validate difficulty
    const diffResult = readEnumField(
      { difficulty_level: body.difficultyLevel || "beginner" },
      "difficulty_level",
      DIFFICULTY_LEVELS
    );
    if (diffResult.error || !diffResult.value) {
      throw new HttpError(422, diffResult.error || `difficultyLevel должен быть одним из: ${DIFFICULTY_LEVELS.join(", ")}`);
    }

    // Validate status
    const statusResult = readEnumField(
      { status: body.status || "draft" },
      "status",
      LESSON_STATUSES
    );
    if (statusResult.error || !statusResult.value) {
      throw new HttpError(422, statusResult.error || `status должен быть одним из: ${LESSON_STATUSES.join(", ")}`);
    }

    // Validate price
    let price = 0;
    if (body.price !== undefined && body.price !== null) {
      if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price < 0) {
        throw new HttpError(422, "price должен быть неотрицательным числом");
      }
      if (body.price > MAX_PRICE) {
        throw new HttpError(422, `price слишком большой (макс ${MAX_PRICE})`);
      }
      price = body.price;
    }

    // Validate durationMin
    let durationMin: number | null = null;
    if (body.durationMin !== undefined && body.durationMin !== null) {
      if (typeof body.durationMin !== "number" || !Number.isInteger(body.durationMin) || body.durationMin < 1) {
        throw new HttpError(422, "durationMin должен быть положительным целым числом");
      }
      if (body.durationMin > MAX_DURATION) {
        throw new HttpError(422, `durationMin слишком большой (макс ${MAX_DURATION} минут)`);
      }
      durationMin = body.durationMin;
    }

    const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : null;

    const { data: lesson, error } = await supabaseAdmin
      .from("confectioner_lessons")
      .insert({
        confectioner_id: conf.id,
        title: body.title,
        description,
        type: typeResult.value,
        difficulty_level: diffResult.value,
        video_url: videoUrl,
        duration_min: durationMin,
        price,
        status: statusResult.value,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[lessons] insert failed:", error.message);
      throw new HttpError(500, "Не удалось создать урок");
    }
    return NextResponse.json({ lesson }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
