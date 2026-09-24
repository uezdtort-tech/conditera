/**
 * POST /api/ai-dialogue/respond
 *
 * Генерирует AI-ответ с учётом контекста отношений.
 *
 * Тело: { message, customerId, confectionerId, chatHistory? }
 * Возвращает: { suggestion, reasoning, confidence, context }
 *
 * Auth: AUTHENTICATED
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  getRelationshipContext,
  getConversationMemories,
  generateContextualResponse,
  extractFactsFromMessage,
  saveMemories,
} from "@/lib/ai-dialogue/engine";

export const runtime = "nodejs";

interface RespondBody {
  message: string;
  customerId: string;
  confectionerId: string;
  chatHistory?: string[];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

    const body = (await request.json()) as RespondBody;
    const { message, customerId, confectionerId, chatHistory = [] } = body;

    if (!message || !customerId || !confectionerId) {
      return NextResponse.json({ error: "message, customerId, confectionerId обязательны" }, { status: 400 });
    }

    const [context, memories] = await Promise.all([
      getRelationshipContext(customerId, confectionerId),
      getConversationMemories(customerId, confectionerId),
    ]);

    // context может быть null при сбое БД — используем дефолтный
    const safeContext = context ?? {
      customerId,
      confectionerId,
      ordersCount: 0,
      chatsCount: 0,
      relationshipType: "new",
      preferences: {},
      communicationStyle: {},
      keyFacts: [],
      trustScore: 0,
      avgRating: 0,
    };

    const facts = await extractFactsFromMessage(message, "customer", {
      relationshipType: safeContext.relationshipType,
      previousMessages: chatHistory,
    });

    const response = await generateContextualResponse(message, {
      relationshipType: safeContext.relationshipType,
      memories,
      preferences: safeContext.preferences || {},
      communicationStyle: safeContext.communicationStyle || {},
      ordersCount: safeContext.ordersCount || 0,
      customerName: undefined,
      confectionerName: undefined,
    });

    try {
      await saveMemories(customerId, confectionerId, facts);
    } catch (e: any) {
      console.warn("[ai-dialogue/respond] saveMemories failed:", e?.message);
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[ai-dialogue/respond] error:", error?.message);
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}
