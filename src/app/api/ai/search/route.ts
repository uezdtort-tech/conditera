/**
 * POST /api/ai/search — умный поиск десертов (сценарий №1 из AI-макета).
 *
 * Покупатель описывает задачу естественным языком:
 *   «Нужен торт на день рождения ребёнка, без орехов, на 10 человек, к субботе»
 *
 * Сервер:
 *   1. Разбирает запрос через LLM в структурированные фильтры
 *      (повод, категория, порции, бюджет, ограничения, вкусы, ключевые слова).
 *   2. Возвращает фильтры + короткий ответ + до 2 уточняющих вопросов.
 *
 * ВАЖНО (правила дизайна):
 *   • Подбор товаров делает КЛИЕНТ по этим фильтрам (store/catalog-логика),
 *     поэтому AI не может «выдумать» товар, которого нет.
 *   • dateHint — информационный параметр: доступность подтверждает продавец.
 *   • Никаких персональных данных в LLM не передаётся (только текст запроса).
 *
 * Тело: { query: string }
 * Ответ: { reply, filters: AiSearchFilters, generatedBy: "llm" | "rules" }
 */
import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";
import { safeJsonBody, handleRouteError, HttpError } from "@/lib/http-helpers";
import { normalizeAiFilters, emptyAiFilters, AI_KNOWN_TASTES, AI_CATEGORY_DICT } from "@/lib/ai-search-types";

export const runtime = "nodejs";

const MAX_QUERY_LEN = 500;

const SYSTEM_PROMPT = `Ты — парсер запросов покупателя для кондитерского маркетплейса «Уездный кондитер».
Задача: превратить описание задачи ("что нужно найти") в структурированные фильтры каталога.

Категории каталога (slug): ${AI_CATEGORY_DICT.map((c) => c.slug).join(", ")}.

Строгие правила:
1. Извлекай ТОЛЬКО то, что явно сказано в запросе. Ничего не выдумывай.
2. tastes — вкусы, которые покупатель ХОЧЕТ ("с малиной" → ["ягоды"], "шоколадный" → ["шоколад"]).
3. exclude — ограничения-исключения ("без орехов" → ["орехи"], "без сахара" → ["сахар"], "без глютена" → ["глютен"]).
4. keywords — 1-4 существительных-предмета поиска ("медовик", "макаронс").
5. category — один slug из списка или null, если неясно.
6. budget — число в рублях ("до 12 000 ₽" → 12000).
7. guests — число человек/порций ("на 10 человек" → 10).
8. dateHint — срок строкой ("к субботе"), НЕ фильтр, только информация.
9. Дата готовности и наличие НЕ подтверждаются тобой — их подтверждает продавец.
10. Если ключевых параметров мало (не понятен ни предмет, ни повод) — задай 1-2 коротких уточняющих вопроса в clarifying, иначе clarifying = [].

Верни СТРОГО JSON без markdown:
{
  "occasion": string | null,
  "category": string | null,
  "guests": number | null,
  "budget": number | null,
  "dateHint": string | null,
  "tastes": string[],
  "exclude": string[],
  "keywords": string[],
  "reply": "1-2 коротких предложения: что я понял(а) из запроса",
  "clarifying": string[]
}`;

/** Fallback-парсер: работает без LLM (regex + словари). */
function ruleBasedParse(query: string) {
  const q = query.toLowerCase();
  const filters = emptyAiFilters();

  // Бюджет: "до 12 000", "до 12000 ₽", "бюджет 5000"
  const budgetMatch = q.match(/(?:до|бюджет[а-я]*\s*|не дороже\s*)(\d[\d\s.,]{2,9})/) || q.match(/(\d[\d\s]{4,9})\s*(?:₽|руб)/);
  if (budgetMatch) {
    const num = Number(budgetMatch[1].replace(/[\s.,]/g, ""));
    if (Number.isFinite(num) && num >= 100 && num <= 10_000_000) filters.budget = Math.round(num);
  }

  // Гости/порции: "на 10 человек", "10 персон", "на 20 гостей"
  const guestsMatch = q.match(/(?:на\s*)?(\d{1,3})\s*(?:человек|чел|перс|гост|порц)/);
  if (guestsMatch) {
    const n = Number(guestsMatch[1]);
    if (n > 0 && n <= 1000) filters.guests = n;
  }

  // Исключения: "без орехов", "без орехов и сахара"
  const excludeMatch = q.match(/без\s+([а-яёa-z\s,]+)/);
  if (excludeMatch) {
    const words = excludeMatch[1].split(/[,и\s]+/).filter((w) => w.length > 2);
    filters.exclude = words.slice(0, 6);
  }

  // Вкусы из словаря
  filters.tastes = AI_KNOWN_TASTES.filter((t) => q.includes(t)).slice(0, 4);

  // Дата: "к субботе", "завтра"
  const dateMatch = q.match(/(?:к|до)\s+(пятниц|суббот|воскресень|понедельн|вторник|сред|четверг)[а-яё]*/) || q.match(/(завтра|послезавтра|сегодня)/);
  if (dateMatch) filters.dateHint = dateMatch[0].trim();

  // Повод
  const occasions: Array<[RegExp, string]> = [
    [/свадьб/, "свадьба"],
    [/день рождения|дня рождения/, "день рождения"],
    [/корпоратив/, "корпоратив"],
    [/детск|ребен|дочке|сыну/, "детский праздник"],
    [/юбилей|годовщин/, "юбилей"],
  ];
  for (const [re, name] of occasions) {
    if (re.test(q)) {
      filters.occasion = name;
      break;
    }
  }

  // Категория
  for (const cat of AI_CATEGORY_DICT) {
    if (cat.words.some((w) => q.includes(w))) {
      // "без сахара" не делает категорию healthy, если явных ограничений нет
      if (cat.slug === "healthy" && filters.exclude.length === 0 && filters.tastes.length === 0) continue;
      filters.category = cat.slug;
      break;
    }
  }

  // Ключевые слова: популярные названия
  const kwDict = ["медовик", "наполеон", "красный бархат", "чизкейк", "тирамису", "эклер", "зефир", "пряник", "рулет"];
  filters.keywords = kwDict.filter((k) => q.includes(k)).slice(0, 4);

  const parts: string[] = [];
  if (filters.category) parts.push("предмет поиска понял");
  if (filters.guests) parts.push(`${filters.guests} чел.`);
  if (filters.budget) parts.push(`до ${filters.budget.toLocaleString("ru-RU")} ₽`);
  if (filters.exclude.length) parts.push(`без ${filters.exclude.join(", ")}`);
  filters.reply = parts.length
    ? `Понял запрос: ${parts.join(", ")}. Подобрал варианты из каталога.`
    : "Разобрал запрос по стандартным правилам. Примените фильтры или уточните детали.";

  return filters;
}

async function llmParse(query: string) {
  const { chatComplete } = await import("@/lib/llm");
  const result = await chatComplete([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: query },
  ]);
  if (!result) throw new Error("LLM недоступен (Ollama/z-ai)");

  const reply = result.text;
  const jsonMatch = reply.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("LLM вернула невалидный JSON");
  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  const llmReply = typeof parsed.reply === "string" ? parsed.reply : "";
  const clarifying = Array.isArray(parsed.clarifying)
    ? parsed.clarifying.filter((c): c is string => typeof c === "string").slice(0, 2)
    : [];
  return { filters: normalizeAiFilters(parsed, llmReply, clarifying) };
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // Rate-limit: платный LLM-вызов — защита от сжигания квоты без auth
    const ip = getClientIP(request);
    const blocked = await enforceRateLimit(request, `ai-search:${ip}`, RATE_LIMITS.ai.limit, RATE_LIMITS.ai.windowMs);
    if (blocked) return blocked;

    const { data: body, error: parseErr } = await safeJsonBody<{ query?: unknown }>(request);
    if (parseErr) throw new HttpError(400, parseErr);
    if (!body || typeof body.query !== "string") {
      throw new HttpError(400, "Поле query обязательно");
    }

    const query = body.query.trim();
    if (query.length < 3) throw new HttpError(400, "Опишите запрос подробнее (минимум 3 символа)");
    if (query.length > MAX_QUERY_LEN) throw new HttpError(400, `Запрос слишком длинный (максимум ${MAX_QUERY_LEN} символов)`);

    try {
      const { filters } = await llmParse(query);
      return NextResponse.json({ filters, generatedBy: "llm" });
    } catch (llmErr) {
      console.warn("[ai/search] LLM failed, falling back to rules:", llmErr instanceof Error ? llmErr.message : llmErr);
      const filters = ruleBasedParse(query);
      return NextResponse.json({ filters, generatedBy: "rules" });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
