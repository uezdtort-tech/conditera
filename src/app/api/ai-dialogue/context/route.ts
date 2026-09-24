/**
 * GET /api/ai-dialogue/context?customerId=...&confectionerId=...
 *
 * Возвращает контекст отношений + память + рекомендации
 *
 * Auth: AUTHENTICATED
 *
 * Безопасность:
 *   • GET: requires AUTHENTICATED.
 *   • Если customerId не указан — используем userId из JWT (можно смотреть только свой контекст).
 *   • При сбое engine функций — возвращаем 500 с общим сообщением.
 *   • Type-safe interfaces для RelationshipContext, ConversationMemory, Recommendation.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getRelationshipContext, getConversationMemories } from "@/lib/ai-dialogue/engine";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RelationshipContext {
  relationshipType: "new" | "repeat" | "regular" | "vip";
  avgRating?: number;
  totalOrders?: number;
  [key: string]: unknown;
}

interface ConversationMemory {
  memoryType: string;
  content: string;
  [key: string]: unknown;
}

interface RecommendationsResult {
  context: RelationshipContext;
  memories: ConversationMemory[];
  recommendations: string[];
}

function generateRecommendations(
  context: RelationshipContext,
  memories: ConversationMemory[]
): string[] {
  const recs: string[] = [];
  const type = context.relationshipType;

  if (type === "new") {
    recs.push("Первый заказ — будьте формальны и уточняйте детали");
    recs.push("Предложите популярные начинки из портфолио");
    recs.push("Узнайте о диетических ограничениях");
  } else if (type === "repeat") {
    const prefs = memories.filter((m) => m.memoryType === "preference");
    if (prefs.length > 0 && prefs[0]?.content) {
      recs.push(`Помните: ${prefs[0].content}`);
    }
    recs.push("Предложите вариацию прошлого заказа");
    recs.push("Уточните — те же предпочтения или пробуем новое?");
  } else if (type === "regular") {
    recs.push("Можно использовать неформальный тон");
    recs.push("Предложите новинку или сезонный торт");
    if (typeof context.avgRating === "number" && context.avgRating >= 4.5) {
      recs.push("Премиальный клиент — предложите эксклюзивный дизайн");
    }
  } else if (type === "vip") {
    recs.push("VIP-клиент — персональный подход");
    recs.push("Предложите бесплатную доставку как бонус");
    recs.push("Эксклюзивный дизайн или ограниченную серию");
  }

  // Аллергии — всегда критично
  const allergies = memories.filter((m) => m.memoryType === "allergy");
  if (allergies.length > 0) {
    const allergyContents = allergies
      .map((a) => a.content)
      .filter(Boolean);
    if (allergyContents.length > 0) {
      recs.push(`⚠ ВНИМАНИЕ: ${allergyContents.join("; ")}`);
    }
  }

  // Бюджет
  const budget = memories.find((m) => m.memoryType === "budget");
  if (budget?.content) {
    recs.push(`Бюджет: ${budget.content}`);
  }

  return recs;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const sp = request.nextUrl.searchParams;
    const customerId = sp.get("customerId") || user.userId;
    const confectionerId = sp.get("confectionerId");
    if (!confectionerId) {
      throw new HttpError(400, "confectionerId обязательен");
    }

    // Параллельная загрузка context и memories.
    // engine.ts не типизирован полностью, поэтому функции возвращают null
    // по выведенному типу — приводим через unknown к нужным типам.
    const [contextRaw, memoriesRaw] = await Promise.all([
      getRelationshipContext(customerId, confectionerId) as unknown as Promise<RelationshipContext | null>,
      getConversationMemories(customerId, confectionerId) as unknown as Promise<ConversationMemory[] | null>,
    ]);

    const context: RelationshipContext = contextRaw ?? { relationshipType: "new" };
    const memories: ConversationMemory[] = memoriesRaw ?? [];

    const recommendations = generateRecommendations(context, memories);

    const result: RecommendationsResult = {
      context,
      memories,
      recommendations,
    };

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
