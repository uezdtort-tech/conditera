/**
 * POST /api/products/ai-description
 *
 * Генерирует продающее описание торта через LLM (z-ai-web-dev-sdk).
 *
 * Тело: {
 *   title: string,              // "Шоколадный торт с малиной"
 *   category?: string,          // "wedding" | "birthday" | "chocolate"
 *   fillings?: string[],        // ["Шоколадный бисквит", "Ганаш"]
 *   weight?: string,            // "1.5 кг"
 *   servings?: number,          // 12
 *   price?: number,             // 2500
 *   tone?: "selling" | "elegant" | "playful" | "minimal",
 *   maxLength?: number,         // 500 (по умолчанию)
 * }
 *
 * Возвращает: {
 *   description: string,
 *   shortDescription: string,   // для превью (до 150 символов)
 *   tags: string[],             // предложенные теги
 *  seoKeywords: string[],       // для мета-тегов
 * }
 *
 * Fallback на шаблонное описание если LLM недоступна.
 */
import { NextRequest, NextResponse } from "next/server";

const TONES = {
  selling: "продающий, эмоциональный, вызывает желание купить прямо сейчас",
  elegant: "элегантный, утончённый, премиальный",
  playful: "игривый, дружелюбный, с лёгким юмором",
  minimal: "минималистичный, краткий, по делу",
};

const SYSTEM_PROMPT = `Ты — профессиональный копирайтер для кондитерского маркетплейса «Уездный кондитер».
Твоя задача — писать продающие описания тортов, которые:
1. Вызывают аппетит и эмоции
2. Описывают вкус, текстуру, аромат
3. Подходят для повода (свадьба, день рождения, корпоратив)
4. Содержат ключевые слова для SEO
5. Не превышают указанную длину

Формат ответа — строго JSON:
{
  "description": "полное описание (до {maxLength} символов)",
  "shortDescription": "краткое описание для превью (до 150 символов)",
  "tags": ["тег1", "тег2", "тег3"],
  "seoKeywords": ["ключевое слово 1", "ключевое слово 2"]
}

Без markdown, без пояснений, только JSON.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      category,
      fillings = [],
      weight,
      servings,
      price,
      tone = "selling",
      maxLength = 500,
    } = body;

    if (!title || title.length < 3) {
      return NextResponse.json(
        { error: "Название товара обязательно (минимум 3 символа)" },
        { status: 400 }
      );
    }

    // === Пробуем LLM ===
    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();

      const toneDesc = TONES[tone as keyof typeof TONES] || TONES.selling;

      const userPrompt = `Сгенерируй описание для торта:
Название: ${title}
Категория: ${category || "не указана"}
Начинки: ${fillings.length > 0 ? fillings.join(", ") : "не указаны"}
Вес: ${weight || "не указан"}
Порций: ${servings || "не указано"}
Цена: ${price ? price + " ₽" : "не указана"}

Тон описания: ${toneDesc}
Максимальная длина: ${maxLength} символов.

Верни только JSON с полями: description, shortDescription, tags (3-5 тегов), seoKeywords (5-7 слов).`;

      const response = await zai.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT.replace("{maxLength}", String(maxLength)) },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        thinking: { type: "disabled" },
      });

      const reply = response.choices?.[0]?.message?.content || "";

      // Извлекаем JSON
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.description) {
          return NextResponse.json({
            description: String(parsed.description).slice(0, maxLength),
            shortDescription: String(parsed.shortDescription || "").slice(0, 150),
            tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 7) : [],
            seoKeywords: Array.isArray(parsed.seoKeywords) ? parsed.seoKeywords.slice(0, 10) : [],
            generatedBy: "llm",
            tone,
          });
        }
      }
      throw new Error("LLM вернула невалидный JSON");
    } catch (llmErr: any) {
      console.warn("[ai-description] LLM failed:", llmErr?.message);
    }

    // === Fallback: шаблонное описание ===
    const fallback = generateFallbackDescription(title, category, fillings, weight, servings, price, tone);
    return NextResponse.json({
      ...fallback,
      generatedBy: "template",
      tone,
    });
  } catch (error) {
    console.error("[ai-description] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function generateFallbackDescription(
  title: string,
  category?: string,
  fillings: string[] = [],
  weight?: string,
  servings?: number,
  price?: number,
  tone?: string
) {
  const fillingsText = fillings.length > 0
    ? `Начинка: ${fillings.join(", ")}. `
    : "";

  const weightText = weight ? `Вес: ${weight}. ` : "";
  const servingsText = servings ? `${servings} порций. ` : "";
  const priceText = price ? `Цена: ${price} ₽. ` : "";

  const categoryText = category
    ? `Идеально подходит для: ${category === "wedding" ? "свадьбы" :
       category === "birthday" ? "дня рождения" :
       category === "corporate" ? "корпоратива" :
       category === "chocolate" ? "любителей шоколада" : "праздника"}. `
    : "";

  const description = `${title} — ${tone === "playful" ? "самый вкусный" : "премиальный"} торт ручной работы от кондитеров маркетплейса «Уездный кондитер». ${fillingsText}${weightText}${servingsText}${categoryText}${priceText}Каждый торт изготавливается из натуральных ингредиентов без консервантов и маргарина. Заказывайте заранее — мы готовим специально для вас!`;

  const shortDescription = `${title} — ${fillings[0] || "премиальный торт"} ручной работы. ${servingsText}${weightText}${priceText}`.slice(0, 150);

  const tags = [
    category || "торт",
    fillings[0] || "ручная работа",
    "натуральные ингредиенты",
    "на заказ",
    weight || servings ? "праздничный" : "вкусный",
  ].slice(0, 5);

  const seoKeywords = [
    title.toLowerCase(),
    "заказать торт",
    "торт на заказ",
    category ? `торт на ${category === "wedding" ? "свадьбу" : category === "birthday" ? "день рождения" : "праздник"}` : "праздничный торт",
    "кондитер",
    "натуральный торт",
    "домашний торт",
  ];

  return { description, shortDescription, tags, seoKeywords };
}

// GET — список тонов
export async function GET() {
  return NextResponse.json({
    tones: Object.entries(TONES).map(([id, desc]) => ({
      id,
      label: {
        selling: "Продающий",
        elegant: "Элегантный",
        playful: "Игривый",
        minimal: "Минималистичный",
      }[id] || id,
      description: desc,
    })),
  });
}
