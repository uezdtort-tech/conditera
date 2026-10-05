/**
 * POST /api/ai/compare — ИИ-помощник выбора: сравнение тортов (сценарий №2).
 *
 * Покупатель отмечает 2-4 товара в каталоге → ИИ сравнивает их простым языком:
 * цена, вес, порции, состав (из карточки), рейтинг, срок изготовления.
 *
 * Правила дизайна (обязательные):
 *   • Сравнение ТОЛЬКО по данным карточек. Нет поля в БД — «данных недостаточно».
 *   • Не ранжируем «качество»: рейтинг — это агрегат отзывов, а не вердикт ИИ.
 *     Объясняем, почему товар показан/подходит, без «этот лучше» как истины.
 *   • Не обещаем доступность/даты — решение за покупателем и продавцом.
 *
 * Тело: { productIds: string[] } (2..4)
 * Ответ: { comparison: { summary, perProduct, bestFor }, products: [...], generatedBy }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeJsonBody, handleRouteError, HttpError } from "@/lib/http-helpers";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

interface DbProduct {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  old_price: number | null;
  weight_grams: number | null;
  servings: number | null;
  tags: string[] | null;
  rating_average: number | null;
  reviews_count: number | null;
}

/**
 * Snapshot карточки от клиента (витрина и так рендерит эти данные).
 * Используется ТОЛЬКО как fallback, когда БД недоступна (например,
 * витрина работает на демо-данных). На живой БД приоритет у БД.
 * Строго валидируется: строки обрезаются, числа клампятся.
 */
interface ProductSnapshotInput {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  price?: unknown;
  oldPrice?: unknown;
  weight?: unknown;          // строка "1.5 кг" или число в граммах
  servings?: unknown;
  tags?: unknown;
  rating?: unknown;
  reviewsCount?: unknown;
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
  // вес: строка "1.5 кг" → граммы; число трактуем как граммы
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
  return {
    id,
    title,
    description: strOrNull(s.description, 800),
    price: numOrNull(s.price, 0, 10_000_000),
    old_price: numOrNull(s.oldPrice, 0, 10_000_000),
    weight_grams: weightGrams,
    servings: numOrNull(s.servings, 1, 1000),
    tags: Array.isArray(s.tags)
      ? (s.tags as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 40)).slice(0, 10)
      : null,
    rating_average: numOrNull(s.rating, 0, 5),
    reviews_count: numOrNull(s.reviewsCount, 0, 1_000_000),
  };
}

interface CompareItem {
  id: string;
  summary: string;
}

interface BestFor {
  id: string;
  when: string;
}

interface ComparisonResult {
  summary: string;
  perProduct: CompareItem[];
  bestFor: BestFor[];
}

const SYSTEM_PROMPT = `Ты — консультант кондитерского маркетплейса «Уездный кондитер».
Сравни 2-4 десерта ИСКЛЮЧИТЕЛЬНО по предоставленным данным карточек.

Жёсткие правила:
1. Используй только факты из карточек. Нет данных (вес/порции/состав = null) — так и скажи: "вес не указан".
2. НЕ ранжируй по «качеству»: рейтинг — агрегат отзывов покупателей, а не оценка ИИ.
3. Формулируй просто и по делу, без маркетинговых преувеличений.
4. bestFor — к какому сценарию товар подходит по своим параметрам (бюджет, размер), НЕ «самый вкусный».
5. Цены и наличие подтверждает продавец — не обещай скидки и сроки.

Верни СТРОГО JSON без markdown:
{
  "summary": "2-4 предложения: главные различия простым языком",
  "perProduct": [{ "id": "...", "summary": "1 предложение о товаре по фактам" }],
  "bestFor": [{ "id": "...", "when": "когда выбрать этот (сценарий)" }]
}`;

async function fetchProducts(ids: string[]): Promise<DbProduct[] | null> {
  // null = БД недоступна (песочница/демо-витрина) — вызывающий уйдёт в snapshot-фоллбэк
  try {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(
        "id, title, description, price, old_price, weight_grams, servings, tags, rating_average, reviews_count"
      )
      .in("id", ids)
      .eq("status", "published");

    if (error) return null;
    return (data || []) as DbProduct[];
  } catch {
    return null;
  }
}

function formatProductForLlm(p: DbProduct): string {
  const lines = [
    `id: ${p.id}`,
    `название: ${p.title}`,
    `цена: ${p.price !== null ? `${p.price} ₽` : "не указана"}`,
    `старая цена: ${p.old_price !== null ? `${p.old_price} ₽` : "нет"}`,
    `вес: ${p.weight_grams !== null ? `${p.weight_grams} г` : "не указан"}`,
    `порций: ${p.servings !== null ? p.servings : "не указано"}`,
    `рейтинг: ${p.rating_average !== null ? p.rating_average : "нет данных"} (${p.reviews_count ?? 0} отзывов)`,
    `теги: ${p.tags && p.tags.length > 0 ? p.tags.join(", ") : "нет"}`,
    `описание: ${p.description ? p.description.slice(0, 400) : "нет"}`,
  ];
  return lines.join("\n");
}

/** Fallback-сравнение без LLM: честная таблица фактов. */
function ruleBasedComparison(products: DbProduct[]): ComparisonResult {
  const perProduct: CompareItem[] = products.map((p) => {
    const bits: string[] = [];
    bits.push(p.price !== null ? `${p.price.toLocaleString("ru-RU")} ₽` : "цена не указана");
    if (p.weight_grams !== null) bits.push(`${(p.weight_grams / 1000).toFixed(2)} кг`);
    else bits.push("вес не указан");
    if (p.servings !== null) bits.push(`${p.servings} порц.`);
    if (p.rating_average !== null) bits.push(`рейтинг ${p.rating_average} (${p.reviews_count ?? 0} отзывов)`);
    return { id: p.id, summary: bits.join(", ") };
  });

  const withPrice = products.filter((p) => p.price !== null);
  const cheapest = withPrice.length > 1 ? withPrice.reduce((a, b) => ((a.price ?? Infinity) <= (b.price ?? Infinity) ? a : b)) : null;
  const biggest = products.filter((p) => p.servings !== null && p.servings > 0);
  const biggestServing = biggest.length > 1 ? biggest.reduce((a, b) => ((a.servings ?? 0) >= (b.servings ?? 0) ? a : b)) : null;

  const bestFor: BestFor[] = products.map((p) => {
    if (cheapest && p.id === cheapest.id) return { id: p.id, when: "если важнее всего бюджет" };
    if (biggestServing && p.id === biggestServing.id) return { id: p.id, when: "если нужно на большую компанию" };
    return { id: p.id, when: "по описанию из карточки" };
  });

  return {
    summary:
      "Сравнение по данным карточек (ИИ-разбор недоступен, показаны факты). " +
      "Обратите внимание на цену, вес и число порций — остальное уточните у мастера.",
    perProduct,
    bestFor,
  };
}

async function llmCompare(products: DbProduct[]): Promise<ComparisonResult> {
  const { chatComplete } = await import("@/lib/llm");

  const userPrompt = `Сравни эти товары (данные из карточек):\n\n${products
    .map((p, i) => `Товар ${i + 1}:\n${formatProductForLlm(p)}`)
    .join("\n\n")}`;

  const result = await chatComplete([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);
  if (!result) throw new Error("LLM недоступен (Ollama/z-ai)");

  const reply = result.text;
  const jsonMatch = reply.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("LLM вернула невалидный JSON");
  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  const perProduct = (Array.isArray(parsed.perProduct) ? parsed.perProduct : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .filter((x) => typeof x.id === "string" && typeof x.summary === "string")
    .map((x) => ({ id: x.id as string, summary: (x.summary as string).slice(0, 300) }));

  const bestFor = (Array.isArray(parsed.bestFor) ? parsed.bestFor : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .filter((x) => typeof x.id === "string" && typeof x.when === "string")
    .map((x) => ({ id: x.id as string, when: (x.when as string).slice(0, 200) }));

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 1000) : "",
    perProduct,
    bestFor,
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ip = getClientIP(request);
    const blocked = await enforceRateLimit(request, `ai-compare:${ip}`, RATE_LIMITS.ai.limit, RATE_LIMITS.ai.windowMs);
    if (blocked) return blocked;

    const { data: body, error: parseErr } = await safeJsonBody<{ productIds?: unknown; products?: unknown }>(request);
    if (parseErr) throw new HttpError(400, parseErr);

    const ids = Array.isArray(body?.productIds)
      ? body.productIds.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 4)
      : [];
    if (ids.length < 2) throw new HttpError(400, "Для сравнения нужно минимум 2 товара");
    if (new Set(ids).size !== ids.length) throw new HttpError(400, "Товары для сравнения повторяются");

    // Данные карточек: приоритет — БД; если БД недоступна — валидированный snapshot витрины
    let products: DbProduct[] | null = await fetchProducts(ids);
    if (products === null) {
      const snapshots = Array.isArray(body?.products) ? (body.products as ProductSnapshotInput[]) : [];
      const parsed = snapshots
        .map(snapshotToDbProduct)
        .filter((x): x is DbProduct => x !== null)
        .filter((x) => ids.includes(x.id))
        .slice(0, 4);
      if (parsed.length >= 2) {
        products = parsed;
      } else {
        throw new HttpError(503, "Каталог временно недоступен — попробуйте позже");
      }
    } else if (products.length < 2) {
      throw new HttpError(404, "Некоторые товары не найдены в каталоге — обновите страницу и попробуйте снова");
    }

    let comparison: ComparisonResult;
    let generatedBy: "llm" | "rules" = "llm";
    try {
      comparison = await llmCompare(products);
    } catch (llmErr) {
      console.warn("[ai/compare] LLM failed, falling back to rules:", llmErr instanceof Error ? llmErr.message : llmErr);
      comparison = ruleBasedComparison(products);
      generatedBy = "rules";
    }

    return NextResponse.json({ comparison, products, generatedBy });
  } catch (error) {
    return handleRouteError(error);
  }
}
