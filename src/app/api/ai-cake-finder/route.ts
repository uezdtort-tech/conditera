/**
 * POST /api/ai-cake-finder
 *
 * AI-консультант по подбору торта.
 * Серия вопросов → персональные рекомендации.
 *
 * Тело: {
 *   messages: Array<{ role: "user"|"assistant", content: string }>,
 *   budget?: number,
 *   servings?: number,
 *   occasion?: string,
 *   city?: string,
 * }
 *
 * Использует LLM для диалога + ищет товары в БД.
 *
 * Безопасность:
 *   • safeJsonBody для парсинга тела.
 *   • При сбое LLM — fallback на шаблонные вопросы.
 *   • При сбое БД в findProducts — возвращаем пустой массив.
 *   • Type-safe interfaces.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeJsonBody, handleRouteError, HttpError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiFinderBody {
  messages?: ChatMessage[];
  budget?: number;
  servings?: number;
  occasion?: string;
  city?: string;
}

interface ProductRow {
  id: string;
  title: string;
  price: number;
  images: string[] | null;
  rating: number | null;
  servings: number | null;
  category: string | null;
}

interface Recommendation {
  id: string;
  title: string;
  reason: string;
  priceFrom: number;
  image?: string | null;
  rating: number | null;
}

const SYSTEM_PROMPT = `Ты — AI-консультант по подбору торта на маркетплейсе «Уездный кондитер».
Помоги покупателю выбрать идеальный торт за 3-5 вопросов.

Сценарий диалога:
1. "Какой у вас повод?" (свадьба, день рождения, корпоратив, другой)
2. "На сколько человек нужен торт?" (узнать порции)
3. "Какие вкусы вы любите?" (шоколад, ягоды, ваниль, карамель)
4. "Есть ли аллергии или диетические ограничения?"
5. "Какой бюджет?" (или предложить варианты)

Правила:
- Дружелюбный, краткий (1-2 вопроса за сообщение)
- После сбора информации — предложи 2-3 конкретных варианта
- Учитывай бюджет и порции
- Если бюджет низкий — предложи более простые варианты
- Всегда предлагай перейти к заказу

Верни JSON: { "reply": "текст ответа", "stage": "questioning"|"recommending"|"done", "recommendations": [] }
рекомендации: [{ "title": "название", "reason": "почему подходит", "priceFrom": число }]`;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { data: body, error: parseErr } = await safeJsonBody<AiFinderBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    const messages = body.messages || [];
    const { budget, servings, occasion, city } = body;

    // Если уже есть достаточно данных — ищем товары
    if (budget && servings) {
      const products = await findProducts(budget, servings, occasion, city);
      if (products.length > 0) {
        const recommendations: Recommendation[] = products.map((p) => ({
          id: p.id,
          title: p.title,
          reason: `${p.servings || servings} порций, от ${p.price}₽`,
          priceFrom: p.price,
          image: p.images?.[0] || null,
          rating: p.rating,
        }));

        return NextResponse.json({
          reply: `Я подобрал для вас ${products.length} отличных вариантов! Вот что я нашёл:`,
          stage: "recommending",
          recommendations,
        });
      }
    }

    // Иначе — продолжаем диалог через LLM
    let aiReply = "";
    let stage: "questioning" | "recommending" | "done" = "questioning";

    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();

      const context: string[] = [];
      if (budget) context.push(`Бюджет: ${budget}₽`);
      if (servings) context.push(`Порций: ${servings}`);
      if (occasion) context.push(`Повод: ${occasion}`);
      if (city) context.push(`Город: ${city}`);

      const userPrompt = context.length > 0
        ? `Контекст: ${context.join(", ")}\n\nДиалог:\n${messages.map((m) => `${m.role}: ${m.content}`).join("\n")}\n\nОтветь:`
        : `${messages.map((m) => `${m.role}: ${m.content}`).join("\n")}\n\nОтветь:`;

      const response = await zai.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        thinking: { type: "disabled" },
      });

      const reply = (response.choices?.[0]?.message?.content as string) || "";
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            reply?: string;
            stage?: string;
            recommendations?: unknown[];
          };
          aiReply = parsed.reply || reply;
          if (parsed.stage === "questioning" || parsed.stage === "recommending" || parsed.stage === "done") {
            stage = parsed.stage;
          }
        } catch {
          aiReply = reply;
        }
      } else {
        aiReply = reply;
      }
    } catch {
      // Fallback — простые вопросы
      aiReply = getFallbackReply(messages.length, budget, servings, occasion);
    }

    return NextResponse.json({ reply: aiReply, stage, recommendations: [] });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function findProducts(
  budget: number,
  servings: number,
  _occasion?: string,
  city?: string
): Promise<ProductRow[]> {
  try {
    let query = supabaseAdmin
      .from("products")
      .select("id, title, price, images, rating, servings, category")
      .lte("price", budget)
      .order("rating", { ascending: false })
      .limit(5);

    if (servings > 0) {
      query = query.gte("servings", servings);
    }
    if (city) {
      query = query.ilike("city", `%${city}%`);
    }

    const { data, error } = await query as { data: ProductRow[] | null; error: SupabaseError | null };

    if (error) {
      console.warn("[ai-cake-finder] products query failed:", error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[ai-cake-finder] findProducts failed:", msg);
    return [];
  }
}

function getFallbackReply(
  msgCount: number,
  budget?: number,
  servings?: number,
  occasion?: string
): string {
  if (msgCount === 0) {
    return "Здравствуйте! Я помогу подобрать идеальный торт 🎂 Какой у вас повод? (свадьба, день рождения, корпоратив, другой)";
  }
  if (!occasion) {
    return "Отлично! А на сколько человек нужен торт?";
  }
  if (!servings) {
    return "Понятно! Какие вкусы вы предпочитаете? (шоколад, ягоды, ваниль, карамель, другой)";
  }
  if (!budget) {
    return "Хорошо! И последний вопрос — какой у вас бюджет на торт?";
  }
  return "Спасибо за ответы! Подбираю для вас лучшие варианты...";
}
