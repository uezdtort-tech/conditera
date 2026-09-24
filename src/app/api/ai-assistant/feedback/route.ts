/**
 * /api/ai-assistant/feedback/route.ts — обратная связь на ответ AI.
 *
 * POST /api/ai-assistant/feedback
 *
 * Тело запроса:
 *  {
 *    "log_id": 12345,
 *    "was_helpful": true,         // thumbs up/down
 *    "feedback_text": "Хороший ответ, но..."  // опционально
 *  }
 *
 * Логика:
 *  1. Проверить аутентификацию
 *  2. Проверить, что log_id принадлежит пользователю (user_id)
 *  3. Обновить запись в ai_assistant_logs: was_helpful, feedback_text
 *
 * Права:
 *  POST — только владелец log-записи
 *
 * Используется для:
 *  - Улучшения модели (RLHF — Reinforcement Learning from Human Feedback)
 *  - Аналитики качества ответов (доля thumbs up/down по типам запросов)
 *  - Выявления плохих ответов для ручного разбора
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface FeedbackRequestBody {
  log_id: number;
  was_helpful: boolean;
  feedback_text?: string;
}

/**
 * POST /api/ai-assistant/feedback — оценить ответ AI.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      throw new HttpError(401, "Необходима аутентификация");
    }

    const { data: body, error: parseErr } = await safeJsonBody<FeedbackRequestBody>(request);
    if (parseErr || !body) {
      throw new HttpError(400, parseErr || "Тело запроса обязательно");
    }

    // Валидация
    if (typeof body.log_id !== "number" || !Number.isInteger(body.log_id) || body.log_id < 1) {
      throw new HttpError(422, "log_id должен быть положительным целым числом");
    }
    if (typeof body.was_helpful !== "boolean") {
      throw new HttpError(422, "was_helpful должен быть boolean (true/false)");
    }
    if (body.feedback_text && (typeof body.feedback_text !== "string" || body.feedback_text.length > 1000)) {
      throw new HttpError(422, "feedback_text должен быть строкой до 1000 символов");
    }

    // Проверить, что log принадлежит пользователю
    const { data: log, error: logErr } = await supabaseAdmin
      .from("ai_assistant_logs")
      .select("id, user_id, conversation_id, request_type")
      .eq("id", body.log_id)
      .maybeSingle();

    if (logErr || !log) {
      throw new HttpError(404, "Запись лога не найдена");
    }

    // user_id может быть NULL для системных логов — такие нельзя оценить
    if (!log.user_id) {
      throw new HttpError(422, "Эта запись не может быть оценена");
    }

    if (log.user_id !== user.id) {
      throw new HttpError(403, "Эта запись принадлежит другому пользователю");
    }

    // Обновить лог
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("ai_assistant_logs")
      .update({
        was_helpful: body.was_helpful,
        feedback_text: body.feedback_text ?? null,
      })
      .eq("id", body.log_id)
      .select("id, was_helpful, feedback_text")
      .single();

    if (updateErr) {
      console.error("[ai-assistant/feedback] UPDATE error:", updateErr.message);
      throw new HttpError(500, "Ошибка при сохранении обратной связи", updateErr.message);
    }

    return NextResponse.json({
      data: updated,
      message: "Спасибо за обратную связь! Она помогает улучшить AI-помощника.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
