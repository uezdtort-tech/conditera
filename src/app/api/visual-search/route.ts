/**
 * POST /api/visual-search
 *
 * Поиск товаров по загруженному изображению через VLM (z-ai-web-dev-sdk).
 *
 * Тело: { image: string (base64 или URL), limit?: number }
 *
 * Логика:
 *   1. VLM анализирует изображение → возвращает описание (тип торта, цвет, украшения)
 *   2. Извлекаем ключевые слова и категорию
 *   3. Ищем товары в БД по совпадению title/category/tags
 *   4. Возвращаем найденные товары + AI-описание изображения
 *
 * Fallback: если VLM недоступна — простой поиск по ключевым словам.
 *
 * Безопасность:
 *   • safeJsonBody для парсинга тела.
 *   • Защита от DoS: base64 image ≤ 5 МБ.
 *   • При сбое VLM — fallback на дефолтный анализ.
 *   • При сбое БД — возвращаем пустой массив.
 *   • Type-safe interfaces.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeJsonBody, handleRouteError, HttpError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface VisualSearchBody {
  image?: string;
  limit?: number;
}

interface ImageAnalysis {
  description: string;
  category: string;
  colors: string[];
  tags: string[];
  keywords: string[];
  estimatedWeight: string | null;
  style: string;
}

interface ProductRow {
  id: string;
  title: string;
  price: number;
  images: string[] | null;
  rating: number | null;
  reviews_count: number | null;
  category: string | null;
  tags: string[] | null;
  confectioner_id: string | null;
}

interface ProductWithScore extends ProductRow {
  searchScore: number;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 МБ
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const MAX_KEYWORDS = 5;

const SYSTEM_PROMPT = `Проанализируй изображение торта и верни JSON:
{
  "description": "краткое описание (до 200 символов)",
  "category": "wedding|birthday|chocolate|berry|vanilla|red_velvet|caramel|other",
  "colors": ["основные цвета"],
  "tags": ["тег1", "тег2", "тег3"],
  "keywords": ["ключевое слово для поиска 1", "слово 2"],
  "estimatedWeight": "1.5 кг" или null,
  "style": "modern|classic|rustic|luxury|minimalist"
}

Только JSON, без markdown.`;

const FALLBACK_ANALYSIS: ImageAnalysis = {
  description: "Не удалось проанализировать изображение через AI",
  category: "other",
  colors: [],
  tags: ["торт", "на заказ"],
  keywords: ["торт", "десерт", "кондитер"],
  estimatedWeight: null,
  style: "modern",
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { data: body, error: parseErr } = await safeJsonBody<VisualSearchBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    const image = body.image;
    const limit = Math.min(Math.max(1, body.limit || DEFAULT_LIMIT), MAX_LIMIT);

    if (typeof image !== "string" || image.length === 0) {
      throw new HttpError(400, "Изображение обязательно");
    }

    // Проверяем размер base64 (защита от DoS)
    if (image.startsWith("data:") && image.length > MAX_IMAGE_SIZE) {
      throw new HttpError(400, "Изображение слишком большое (макс 5 МБ)");
    }

    // === 1. VLM-анализ изображения ===
    let analysis: ImageAnalysis = { ...FALLBACK_ANALYSIS };
    let usedVLM = false;

    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();

      const messages = [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: SYSTEM_PROMPT },
            { type: "image_url" as const, image_url: { url: image } },
          ],
        },
      ] as unknown as Array<{ role: "user"; content: string }>;

      const response = await zai.chat.completions.create({
        messages,
        stream: false,
        thinking: { type: "disabled" },
      });

      const reply = (response.choices?.[0]?.message?.content as string) || "";
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as Partial<ImageAnalysis>;
          analysis = {
            description: parsed.description || FALLBACK_ANALYSIS.description,
            category: parsed.category || FALLBACK_ANALYSIS.category,
            colors: Array.isArray(parsed.colors) ? parsed.colors : [],
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
            estimatedWeight: parsed.estimatedWeight || null,
            style: parsed.style || FALLBACK_ANALYSIS.style,
          };
          usedVLM = true;
        } catch {
          // Невалидный JSON — оставляем fallback
        }
      }
    } catch (vlmErr) {
      const msg = vlmErr instanceof Error ? vlmErr.message : String(vlmErr);
      console.warn("[visual-search] VLM failed:", msg);
    }

    // === 2. Поиск товаров по ключевым словам ===
    const searchKeywords = (
      analysis.keywords.length > 0 ? analysis.keywords : analysis.tags
    ).slice(0, MAX_KEYWORDS).map((kw) => kw.toLowerCase().trim()).filter((kw) => kw.length >= 2);

    let products: ProductRow[] = [];

    try {
      // Supabase не поддерживает OR в одной цепочке — используем ilike на title
      // для первого ключевого слова, потом фильтруем на клиенте
      let query = supabaseAdmin
        .from("products")
        .select("id, title, price, images, rating, reviews_count, category, tags, confectioner_id")
        .order("rating", { ascending: false })
        .limit(limit * 3); // берём в 3 раза больше для последующего скоринга

      if (searchKeywords.length > 0) {
        query = query.ilike("title", `%${searchKeywords[0]}%`);
      }

      const { data, error } = await query as { data: ProductRow[] | null; error: SupabaseError | null };

      if (error) throw error;
      products = data || [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[visual-search] keyword search failed:", msg);
    }

    // Если ничего не нашли — возвращаем популярные
    if (products.length === 0) {
      try {
        const { data, error } = await supabaseAdmin
          .from("products")
          .select("id, title, price, images, rating, reviews_count, category, tags, confectioner_id")
          .order("rating", { ascending: false })
          .limit(limit) as { data: ProductRow[] | null; error: SupabaseError | null };

        if (error) throw error;
        products = data || [];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[visual-search] fallback search failed:", msg);
        products = [];
      }
    }

    // Подсчёт совпадения по релевантности (упрощённо)
    const productsWithScore: ProductWithScore[] = products.map((p) => {
      let score = 0;
      const titleLower = (p.title || "").toLowerCase();
      const tags = p.tags || [];
      for (const kw of searchKeywords) {
        if (titleLower.includes(kw)) score += 30;
        if (tags.some((t) => t.toLowerCase().includes(kw))) score += 20;
      }
      if (analysis.category !== "other" && (p.category || "").toLowerCase().includes(analysis.category)) {
        score += 25;
      }
      return { ...p, searchScore: score };
    }).sort((a, b) => b.searchScore - a.searchScore).slice(0, limit);

    return NextResponse.json({
      analysis,
      usedVLM,
      products: productsWithScore,
      total: productsWithScore.length,
      searchKeywords,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET — описание endpoint
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint: "/api/visual-search",
    method: "POST",
    body: { image: "string (base64 data URL или https URL)", limit: "number?" },
    returns: "анализ изображения через VLM + найденные товары",
  });
}
