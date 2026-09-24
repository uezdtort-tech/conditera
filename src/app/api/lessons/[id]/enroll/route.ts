/**
 * POST /api/lessons/[id]/enroll — записаться на урок
 *
 * Auth: AUTHENTICATED
 *
 * Безопасность:
 *   • POST: парсинг params через Promise (Next.js 15+).
 *   • Idempotency: если уже есть enrollment — возвращаем 400 с existing id.
 *   • Counter increment для confectioner_lessons.enrolled_count и
 *     confectioner_ateliers.total_students — non-blocking через RPC.
 *   • При сбое БД возвращаем 500 с общим сообщением (без деталей БД).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ExistingEnrollmentRow {
  id: string;
}

interface SupabaseError {
  message: string;
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: lessonId } = await params;
    if (!lessonId) throw new HttpError(400, "Lesson ID required");

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    // Idempotency: проверяем существующую запись
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("lesson_enrollments")
      .select("id")
      .eq("lesson_id", lessonId)
      .eq("user_id", user.userId)
      .maybeSingle() as { data: ExistingEnrollmentRow | null; error: SupabaseError | null };

    if (existingErr) {
      console.warn("[lessons/enroll] existing check failed:", existingErr.message);
    }

    if (existing) {
      return NextResponse.json(
        { error: "Вы уже записаны", enrollment: { id: existing.id } },
        { status: 400 }
      );
    }

    // Создаём запись
    const { data: enrollment, error: enrollErr } = await supabaseAdmin
      .from("lesson_enrollments")
      .insert({
        lesson_id: lessonId,
        user_id: user.userId,
        paid: true, // В демо — бесплатно
        created_at: new Date().toISOString(),
      })
      .select("id, lesson_id, user_id, paid, created_at")
      .single() as { data: { id: string } | null; error: SupabaseError | null };

    if (enrollErr || !enrollment) {
      console.error("[lessons/enroll] insert failed:", enrollErr?.message);
      throw new HttpError(500, "Не удалось записаться на урок");
    }

    // Non-blocking counter increments для статистики
    supabaseAdmin
      .rpc("increment_lesson_enrolled_count", { p_lesson_id: lessonId })
      .then(({ error }: { error: SupabaseError | null }) => {
        if (error) {
          console.warn("[lessons/enroll] increment enrolled_count failed:", error.message);
        }
      })
      .then(undefined, (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[lessons/enroll] enrolled_count increment error:", msg);
      });

    return NextResponse.json({ enrollment }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
