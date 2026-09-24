/**
 * POST /api/moderation/report — подать жалобу на контент.
 *
 * Тело запроса (валидируется через zod):
 *  {
 *    "contentType": "string",
 *    "contentId": "string",
 *    "reason": "adult_content" | "violence" | "extremism" | "drugs" | "weapons" |
 *              "spam" | "scam" | "insult" | "hate_speech" | "illegal_goods" |
 *              "copyright" | "personal_data" | "other",
 *    "description": "string optional max 2000"
 *  }
 *
 * Логика:
 *   1. Проверить, что пользователь не жаловался ранее на этот же контент (status IN new/in_review)
 *   2. Найти связанную запись в moderation_queue (по contentType+contentId)
 *   3. Создать жалобу в content_reports
 *   4. Если причина критическая (adult_content, extremism, drugs, weapons, illegal_goods):
 *      - Создать запись в moderation_queue если её нет (autoStatus=flagged, score=0.8)
 *      - Отправить Telegram-уведомление модераторам
 *
 * Auth: AUTHENTICATED (любой пользователь может подать жалобу)
 *
 * Соответствует таблицам:
 *  - content_reports (создание жалобы)
 *  - moderation_queue (поиск существующей записи или создание новой при критических жалобах)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { z } from "zod";

export const runtime = "nodejs";

const reportSchema = z.object({
  contentType: z.string().min(1),
  contentId: z.string().min(1),
  reason: z.enum([
    "adult_content", "violence", "extremism", "drugs", "weapons",
    "spam", "scam", "insult", "hate_speech", "illegal_goods",
    "copyright", "personal_data", "other",
  ]),
  description: z.string().max(2000).optional(),
});

const CRITICAL_REASONS = ["adult_content", "extremism", "drugs", "weapons", "illegal_goods"];

/**
 * POST /api/moderation/report — подать жалобу на контент.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = await request.json();
    const parse = reportSchema.safeParse(body);

    if (!parse.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parse.error.flatten() },
        { status: 400 }
      );
    }

    const data = parse.data;

    // 1. Проверить, что пользователь ещё не жаловался на этот контент
    const { data: existing } = await supabaseAdmin
      .from("content_reports")
      .select("id")
      .eq("reporter_id", user.id)
      .eq("content_type", data.contentType)
      .eq("content_id", data.contentId)
      .in("status", ["new", "in_review"])
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "Вы уже подали жалобу на этот контент" },
        { status: 409 }
      );
    }

    // 2. Найти связанную запись в moderation_queue
    const { data: moderationEntry } = await supabaseAdmin
      .from("moderation_queue")
      .select("id")
      .eq("content_type", data.contentType)
      .eq("content_id", data.contentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Создать жалобу
    const { data: report, error: reportErr } = await supabaseAdmin
      .from("content_reports")
      .insert({
        moderation_id: moderationEntry?.id || null,
        content_type: data.contentType,
        content_id: data.contentId,
        reporter_id: user.id,
        reporter_name: user.name || "Пользователь",
        reason: data.reason,
        description: data.description || null,
        status: "new",
      })
      .select()
      .single();

    if (reportErr) {
      console.error("[moderation/report] insert error:", reportErr.message);
      return NextResponse.json(
        { error: "Database insert failed", details: reportErr.message },
        { status: 500 }
      );
    }

    // 4. Если жалоба критическая — создать запись в moderation_queue если её нет
    if (CRITICAL_REASONS.includes(data.reason) && !moderationEntry) {
      try {
        await supabaseAdmin.from("moderation_queue").insert({
          content_type: data.contentType,
          content_id: data.contentId,
          author_id: "reported",
          content: `Жалоба: ${data.description || data.reason}`,
          images: [],
          auto_status: "flagged",
          auto_reason: `Критическая жалоба: ${data.reason}`,
          auto_score: 0.8,
          violations: [data.reason],
          manual_status: "pending",
        });
      } catch (queueErr: any) {
        console.warn("[moderation/report] queue insert failed:", queueErr?.message);
      }
    }

    // Telegram-уведомление для критических жалоб (non-blocking)
    if (CRITICAL_REASONS.includes(data.reason)) {
      try {
        const { sendToChannel } = await import("@/lib/telegram-bot");
        await sendToChannel(
          `🚨 <b>Жалоба на контент</b>\n\n` +
          `<b>Тип:</b> ${data.contentType}\n` +
          `<b>Причина:</b> ${data.reason}\n` +
          `<b>Жалобщик:</b> ${user.name}\n` +
          (data.description ? `<b>Описание:</b> ${data.description}` : "")
        );
      } catch (tgErr: any) {
        console.warn("[moderation/report] Telegram notification failed:", tgErr?.message);
      }
    }

    return NextResponse.json({ report }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/moderation/report error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
