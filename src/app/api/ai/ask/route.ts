/**
 * POST /api/ai/ask — «Помочь выбрать» в карточке товара (сценарий №2).
 *
 * Компактный блок в карточке: покупатель задаёт вопрос по конкретному товару
 * («Хватит ли на 12 человек?», «Есть ли орехи в составе?», «Сколько хранится?»).
 *
 * Grounding-правила (обязательные по AI-макету):
 *   • Отвечаем ТОЛЬКО на основе данных карточки из БД.
 *   • Нет данных → «данных недостаточно, уточните у мастера» (не выдумывать!).
 *   • НЕ обещаем отсутствие аллергенов, свободные даты, доставку и цену —
 *     это подтверждает продавец/система.
 *   • Не отправляем в LLM персональные данные покупателя (только вопрос).
 *
 * Тело: { productId: string, question: string, history?: {role, content}[] (≤6) }
 * Ответ: { answer, missingInfo: string[], generatedBy }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeJsonBody, handleRouteError, HttpError } from "@/lib/http-helpers";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_QUESTION_LEN = 300;
const MAX_HISTORY = 6;

interface AskBody {
  productId?: unknown;
  question?: unknown;
  history?: unknown;
  product?: unknown;
}

interface DbProduct {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  weight_grams: number | null;
  servings: number | null;
  tags: string[] | null;
  rating_average: number | null;
  category_id: string | null;
}

/**
 * Snapshot карточки от клиента — fallback, когда БД недоступна
 * (витрина на демо-данных). Строго валидируется.
 */
interface ProductSnapshotInput {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  price?: unknown;
  weight?: unknown;
  servings?: unknown;
  tags?: unknown;
  rating?: unknown;
  composition?: unknown;
}

function numOrNull(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}

function strOrNull(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, maxLen) : null;
}

function snapshotToDbProduct(s: ProductSnapshotInput): DbProduct | null {
  const id = strOrNull(s.id, 80);
  const title = strOrNull(s.title, 200);
  if (!id || !title) return null;
  let weightGrams: number | null = null;
  if (typeof s.weight === "number" && Number.isFinite(s.weight) && s.weight > 0 && s.weight <= 1_000_000) {
    weightGrams = Math.round(s.weight);
  } else if (typeof s.weight === "string") {
    const m = s.weight.replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(кг|г|гр)?/i);
    if (m) {
      const val = parseFloat(m[1]);
      if (Number.isFinite(val) && val > 0) weightGrams = Math.round(m[2] && /кг/i.test(m[2]) ? val * 1000 : val);
    }
  }
  // Состав (если передан): ингредиенты/аллергены подмешиваем в описание —
  // это данные карточки, они уместны для grounding
  let compositionText = "";
  if (s.composition && typeof s.composition === "object") {
    const comp = s.composition as Record<string, unknown>;
    const list = (v: unknown, n: number) =>
      Array.isArray(v)
        ? (v as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, n)
        : [];
    const ing = list(comp.ingredients, 20);
    const alg = list(comp.allergens, 10);
    const storage = strOrNull(comp.storageConditions, 200);
    const shelf = strOrNull(comp.shelfLife, 200);
    const parts: string[] = [];
    if (ing.length) parts.push(`состав: ${ing.join(", ")}`);
    if (alg.length) parts.push(`аллергены: ${alg.join(", ")}`);
    if (storage) parts.push(`хранение: ${storage}`);
    if (shelf) parts.push(`срок годности: ${shelf}`);
    compositionText = parts.join(". ");
  }
  const descParts = [strOrNull(s.description, 700), compositionText].filter((x): x is string => !!x);
  return {
    id,
    title,
    description: descParts.length ? descParts.join(". ").slice(0, 1000) : null,
    price: numOrNull(s.price, 0, 10_000_000),
    weight_grams: weightGrams,
    servings: numOrNull(s.servings, 1, 1000),
    tags: Array.isArray(s.tags)
      ? (s.tags as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 40)).slice(0, 10)
      : null,
    rating_average: numOrNull(s.rating, 0, 5),
    category_id: null,
  };
}

const SYSTEM_PROMPT = `Ты — консультант карточки товара кондитерского маркетплейса «Уездный кондитер».
Отвечай на вопросы покупателя о КОНКРЕТНОМ товаре.

Жёсткие правила (нарушать нельзя):
1. Опирайся ТОЛЬКО на данные карточки, приведённые ниже. Если ответа в данных нет —
   напиши, что данных недостаточно и предложи уточнить у мастера. НИЧЕГО не выдумывай.
2. Не обещай отсутствие аллергенов, свободные даты, доставку, цену и наличие —
   это подтверждает только продавец. Если в составе не указаны аллергены — так и скажи.
3. Отвечай кратко (2-4 предложения), дружелюбно, простым языком.
4. Не рекомендуй чужие товары и не сравнивай с ними.
5. Если вопрос не про товар/заказ — вежливо верни к теме.

Верни СТРОГО JSON без markdown:
{
  "answer": "текст ответа",
  "missingInfo": ["чего не хватает в карточке для полного ответа"] // может быть []
}`;

function formatProduct(p: DbProduct, confectioner: { businessName: string; city: string | null } | null): string {
  return [
    `название: ${p.title}`,
    `цена: ${p.price !== null ? `${p.price.toLocaleString("ru-RU")} ₽` : "не указана"}`,
    `вес: ${p.weight_grams !== null ? `${p.weight_grams} г` : "не указан"}`,
    `порций: ${p.servings !== null ? p.servings : "не указано"}`,
    `теги: ${p.tags && p.tags.length > 0 ? p.tags.join(", ") : "нет"}`,
    `рейтинг: ${p.rating_average !== null ? p.rating_average : "нет данных"}`,
    `мастер: ${confectioner?.businessName || "не указан"}${confectioner?.city ? `, город: ${confectioner.city}` : ""}`,
    `описание: ${p.description ? p.description.slice(0, 600) : "нет"}`,
  ].join("\n");
}

/** Fallback без LLM: честный ответ «по данным карточки» + перенаправление к мастеру. */
function fallbackAnswer(p: DbProduct): string {
  const facts: string[] = [];
  if (p.price !== null) facts.push(`цена ${p.price.toLocaleString("ru-RU")} ₽`);
  if (p.servings !== null) facts.push(`${p.servings} порций`);
  if (p.weight_grams !== null) facts.push(`вес ${(p.weight_grams / 1000).toFixed(2)} кг`);
  return facts.length
    ? `ИИ-консультант временно недоступен. По данным карточки: ${facts.join(", ")}. Остальные детали лучше уточнить у мастера в чате заказа.`
    : "ИИ-консультант временно недоступен. Задайте вопрос мастеру в чате заказа — он подтвердит состав, сроки и условия.";
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ip = getClientIP(request);
    const blocked = await enforceRateLimit(request, `ai-ask:${ip}`, RATE_LIMITS.ai.limit, RATE_LIMITS.ai.windowMs);
    if (blocked) return blocked;

    const { data: body, error: parseErr } = await safeJsonBody<AskBody>(request);
    if (parseErr) throw new HttpError(400, parseErr);
    if (!body) throw new HttpError(400, "Тело запроса обязательно");

    const productId = typeof body.productId === "string" ? body.productId : "";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!productId) throw new HttpError(400, "productId обязателен");
    if (question.length < 3) throw new HttpError(400, "Задайте вопрос подробнее");
    if (question.length > MAX_QUESTION_LEN) throw new HttpError(400, `Вопрос слишком длинный (максимум ${MAX_QUESTION_LEN} символов)`);

    // История: только последние 6 сообщений, только строки
    const history = Array.isArray(body.history)
      ? (body.history as unknown[])
          .filter((m): m is { role: string; content: string } => {
            const mm = m as Record<string, unknown> | null;
            return (
              !!mm &&
              typeof mm.role === "string" &&
              typeof mm.content === "string" &&
              (mm.role === "user" || mm.role === "assistant")
            );
          })
          .slice(-MAX_HISTORY)
      : [];

    // Данные карточки: приоритет — БД; при недоступности БД — валидированный snapshot витрины
    let p: DbProduct | null = null;
    let confectioner: { businessName: string; city: string | null } | null = null;
    try {
      const { data: product, error: productErr } = await supabaseAdmin
        .from("products")
        .select("id, title, description, price, weight_grams, servings, tags, rating_average, category_id, confectioner_id")
        .eq("id", productId)
        .eq("status", "published")
        .maybeSingle();

      if (!productErr && product) {
        const row = product as DbProduct & { confectioner_id: string | null };
        p = row;
        if (row.confectioner_id) {
          const { data: conf } = await supabaseAdmin
            .from("confectioners")
            .select("businessName, city")
            .eq("id", row.confectioner_id)
            .maybeSingle();
          if (conf) confectioner = conf as { businessName: string; city: string | null };
        }
      }
    } catch {
      // БД недоступна — уйдём в snapshot-фоллбэк ниже
    }

    if (!p) {
      const snap = body.product && typeof body.product === "object" ? snapshotToDbProduct(body.product as ProductSnapshotInput) : null;
      if (snap && snap.id === productId) {
        p = snap;
      } else {
        throw new HttpError(404, "Товар не найден или снят с публикации");
      }
    }

    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();

      const contextMsg = `ДАННЫЕ КАРТОЧКИ ТОВАРА:\n${formatProduct(p, confectioner)}`;

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: contextMsg },
      ];
      // Реплеи истории между контекстом и текущим вопросом
      for (const m of history) {
        messages.push({ role: m.role as "user" | "assistant", content: m.content.slice(0, 500) });
      }
      messages.push({ role: "user", content: `Вопрос покупателя: ${question}` });

      const response = await zai.chat.completions.create({
        messages,
        stream: false,
        thinking: { type: "disabled" },
      });

      const reply = (response.choices?.[0]?.message?.content as string) || "";
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("LLM вернула невалидный JSON");
      const parsed = JSON.parse(jsonMatch[0]) as { answer?: unknown; missingInfo?: unknown };

      const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim().slice(0, 1200) : null;
      if (!answer) throw new Error("LLM вернула пустой ответ");

      const missingInfo = Array.isArray(parsed.missingInfo)
        ? (parsed.missingInfo as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3)
        : [];

      return NextResponse.json({ answer, missingInfo, generatedBy: "llm" });
    } catch (llmErr) {
      console.warn("[ai/ask] LLM failed, using fallback:", llmErr instanceof Error ? llmErr.message : llmErr);
      return NextResponse.json({
        answer: fallbackAnswer(p),
        missingInfo: [],
        generatedBy: "fallback",
      });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
