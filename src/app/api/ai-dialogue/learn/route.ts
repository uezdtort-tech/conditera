/**
 * POST /api/ai-dialogue/learn
 *
 * Запускает обучение AI на основе завершённого диалога или заказа.
 *
 * Тело: {
 *   sourceType: "chat" | "order" | "review",
 *   sourceId: string,
 *   customerId: string,
 *   confectionerId: string,
 *   messages?: Array<{ text, sender, timestamp }>,  // для sourceType="chat"
 *   orderData?: { total, fillings, rating },       // для sourceType="order"
 *   reviewData?: { rating, text },                  // для sourceType="review"
 * }
 *
 * Безопасность:
 *   • POST: requires AUTHENTICATED.
 *   • safeJsonBody + readEnumField (sourceType enum: chat/order/review).
 *   • При сбое engine функций — продолжаем, не блокируем.
 *   • Type-safe interfaces для всех возвращаемых данных.
 *   • Из engine.ts функции возвращают null по типу — приводим через unknown.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";
import {
  getRelationshipContext,
  extractFactsFromMessage,
  saveMemories,
  updateRelationshipAfterOrder,
} from "@/lib/ai-dialogue/engine";

export const runtime = "nodejs";

const SOURCE_TYPES = ["chat", "order", "review"] as const;

interface ChatMessage {
  text: string;
  sender: string;
  timestamp?: string;
}

interface OrderData {
  total?: number;
  fillings?: string[];
  rating?: number;
}

interface ReviewData {
  rating?: number;
  text?: string;
}

interface LearnBody {
  sourceType?: string;
  sourceId?: string;
  customerId?: string;
  confectionerId?: string;
  messages?: ChatMessage[];
  orderData?: OrderData;
  reviewData?: ReviewData;
}

interface ExtractedFact {
  type: string;
  content: string;
  confidence: number;
  [key: string]: unknown;
}

interface RelationshipContextLike {
  relationshipType: "new" | "repeat" | "regular" | "vip";
  [key: string]: unknown;
}

interface SupabaseError {
  message: string;
}

interface AiLearningProfileRow {
  user_id: string;
  suggestion_stats: unknown;
  last_learned_at: string | null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: body, error: parseErr } = await safeJsonBody<LearnBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Валидация обязательных полей
    if (typeof body.customerId !== "string" || body.customerId.length === 0) {
      throw new HttpError(400, "customerId обязателен");
    }
    if (typeof body.confectionerId !== "string" || body.confectionerId.length === 0) {
      throw new HttpError(400, "confectionerId обязателен");
    }
    if (typeof body.sourceId !== "string" || body.sourceId.length === 0) {
      throw new HttpError(400, "sourceId обязателен");
    }

    const sourceTypeResult = readEnumField(
      { sourceType: body.sourceType },
      "sourceType",
      SOURCE_TYPES,
      { required: true }
    );
    if (sourceTypeResult.error || !sourceTypeResult.value) {
      throw new HttpError(422, sourceTypeResult.error || `sourceType должен быть одним из: ${SOURCE_TYPES.join(", ")}`);
    }
    const sourceType = sourceTypeResult.value;

    // engine.ts возвращает null по типу — приводим через unknown.
    const context = (await getRelationshipContext(body.customerId, body.confectionerId)) as unknown as RelationshipContextLike | null;
    const safeContext: RelationshipContextLike = context ?? { relationshipType: "new" };

    const allFacts: ExtractedFact[] = [];
    let memoriesCreated = 0;

    // === Обучение на чате ===
    if (sourceType === "chat" && Array.isArray(body.messages)) {
      const customerMessages = body.messages.filter((m) => m.sender === "customer" && typeof m.text === "string");
      for (const msg of customerMessages) {
        const facts = (await extractFactsFromMessage(msg.text, "customer", {
          relationshipType: safeContext.relationshipType,
          previousMessages: body.messages.map((m) => m.text),
        })) as unknown as ExtractedFact[] | null;
        if (Array.isArray(facts)) {
          allFacts.push(...facts);
        }
      }
      memoriesCreated = (await saveMemories(
        body.customerId, body.confectionerId, allFacts,
        undefined, undefined, body.sourceId
      )) as unknown as number;
    }

    // === Обучение на заказе ===
    if (sourceType === "order" && body.orderData) {
      const orderData = body.orderData;
      // Обновляем контекст отношений
      await updateRelationshipAfterOrder(
        body.customerId, body.confectionerId, body.sourceId,
        orderData.total ?? 0,
        orderData.rating ?? 0
      );

      // Извлекаем факты из заказа
      if (Array.isArray(orderData.fillings)) {
        for (const filling of orderData.fillings) {
          if (typeof filling === "string" && filling.length > 0) {
            allFacts.push({
              type: "preference",
              content: `Заказывал начинку: ${filling}`,
              confidence: 0.9,
            });
          }
        }
      }
      if (typeof orderData.total === "number" && orderData.total > 0) {
        allFacts.push({
          type: "budget",
          content: `Потратил ${orderData.total}₽ на заказ`,
          confidence: 0.95,
        });
      }
      memoriesCreated = (await saveMemories(
        body.customerId, body.confectionerId, allFacts,
        undefined, undefined, body.sourceId
      )) as unknown as number;
    }

    // === Обучение на отзыве ===
    if (sourceType === "review" && body.reviewData) {
      const reviewData = body.reviewData;
      if (typeof reviewData.rating === "number") {
        if (reviewData.rating >= 4) {
          allFacts.push({
            type: "feedback",
            content: `Поставил ${reviewData.rating}★ — доволен`,
            confidence: 0.9,
          });
        } else if (reviewData.rating <= 3) {
          allFacts.push({
            type: "feedback",
            content: `Поставил ${reviewData.rating}★ — есть недочёты`,
            confidence: 0.85,
          });
        }
      }
      if (typeof reviewData.text === "string" && reviewData.text.length > 0) {
        const facts = (await extractFactsFromMessage(reviewData.text, "customer", {
          relationshipType: safeContext.relationshipType,
          previousMessages: [],
        })) as unknown as ExtractedFact[] | null;
        if (Array.isArray(facts)) {
          allFacts.push(...facts);
        }
      }
      memoriesCreated = (await saveMemories(
        body.customerId, body.confectionerId, allFacts,
        undefined, reviewData.text, body.sourceId
      )) as unknown as number;
    }

    // === Обновляем AI Learning Profile ===
    try {
      const { data: profile } = await supabaseAdmin
        .from("ai_learning_profiles")
        .select("user_id, suggestion_stats, last_learned_at")
        .eq("user_id", body.customerId)
        .maybeSingle() as { data: AiLearningProfileRow | null; error: SupabaseError | null };

      const stats = (profile?.suggestion_stats as Record<string, unknown>) || { totalSuggestions: 0, accepted: 0, rejected: 0 };

      const { error: upsertErr } = await supabaseAdmin
        .from("ai_learning_profiles")
        .upsert({
          user_id: body.customerId,
          global_preferences: { extractedFacts: allFacts.length },
          last_learned_at: new Date().toISOString(),
          suggestion_stats: stats,
        }, { onConflict: "user_id" });

      if (upsertErr) {
        console.warn("[ai-dialogue/learn] upsert profile failed:", upsertErr.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[ai-dialogue/learn] AI Learning Profile update failed:", msg);
    }

    // === Записываем лог обучения ===
    try {
      const { error: logErr } = await supabaseAdmin
        .from("ai_learning_logs")
        .insert({
          user_id: body.customerId,
          confectioner_id: body.confectionerId,
          source_type: sourceType,
          source_id: body.sourceId,
          extracted_facts: allFacts,
          memories_created: memoriesCreated,
          created_at: new Date().toISOString(),
        });

      if (logErr) {
        console.warn("[ai-dialogue/learn] log insert failed:", logErr.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[ai-dialogue/learn] AI learning log insert failed:", msg);
    }

    return NextResponse.json({
      success: true,
      learned: {
        factsExtracted: allFacts.length,
        memoriesCreated,
        relationshipType: safeContext.relationshipType,
        facts: allFacts,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
