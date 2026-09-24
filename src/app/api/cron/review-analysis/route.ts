/**
 * POST /api/cron/review-analysis — анализ отзывов через AI (sentiment analysis)
 *
 * Header: X-Cron-Secret — для авторизации cron-запросов
 * Запускается через n8n (workflow 16-review-analysis.json)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const cronSecret = req.headers.get("X-Cron-Secret");
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Получить последние отзывы (за 24 часа)
    const { data: reviews, error } = await supabaseAdmin
      .from("product_reviews")
      .select("id, rating, text, product_id, user_id, created_at")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.warn("[cron/review-analysis] query error:", error.message);
      return NextResponse.json({ processed: 0, error: error.message });
    }

    let analyzed = 0;
    let negativeCount = 0;

    for (const review of reviews || []) {
      // Simple sentiment analysis (in production — AI via n8n/Ollama)
      const text = (review as { text: string }).text?.toLowerCase() || "";
      const negativeWords = ["ужасно", "отвратительно", "плохо", "не понравилось", "разочарован", "никогда больше"];
      const isNegative = negativeWords.some((w) => text.includes(w));

      if (isNegative && (review as { rating: number }).rating <= 2) {
        negativeCount++;
        // Create alert for admin
        await supabaseAdmin.from("moderation_queue").insert({
          item_id: (review as { id: string }).id,
          item_type: "review",
          reason: "negative_sentiment",
          reporter_name: "AI Sentiment Analysis",
          status: "pending",
        });
      }
      analyzed++;
    }

    return NextResponse.json({
      processed: analyzed,
      negative: negativeCount,
      message: `Analyzed ${analyzed} reviews, ${negativeCount} negative flagged`,
    });
  } catch (error) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
