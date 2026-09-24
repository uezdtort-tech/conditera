/**
 * POST /api/fillings/ai-generate-slice
 *
 * Использует LLM (z-ai-web-dev-sdk) для генерации SliceConfig по описанию начинки.
 *
 * Тело запроса:
 *   {
 *     "name": "Шоколадный бисквит с малиновым конфитюром",
 *     "description": "Влажный шоколадный бисквит, прослойка малинового конфитюра, крем-чиз",
 *     "consistency": "влажный",
 *     "color": "#3d2817"
 *   }
 *
 * Возвращает: { config: SliceConfig, explanation: string }
 *
 * LLM возвращает JSON-конфигурацию слоёв с цветами, текстурами и декором.
 * Если LLM недоступна — fallback на детерминированный detectPreset.
 */
import { NextRequest, NextResponse } from "next/server";

interface SliceLayer {
  type: "biscuit" | "cream" | "berry" | "chocolate" | "mousse" | "caramel" | "fruit" | "nuts";
  color: string;
  label: string;
  height: number;
}

interface SliceConfig {
  layers: SliceLayer[];
  coating?: { color: string; label: string };
  decoration?: { type: "berries" | "chocolate" | "nuts" | "sprinkles"; color: string };
  shape?: "round" | "square";
}

// Fallback-генератор (детерминированный, без LLM)
function detectPreset(name: string, description?: string, color?: string): SliceConfig {
  const text = `${name} ${description || ""}`.toLowerCase();

  if (text.includes("шоколад") || text.includes("chocolate")) {
    return {
      layers: [
        { type: "chocolate", color: "#3d2817", label: "Шоколадный бисквит", height: 3 },
        { type: "cream", color: "#1a0d08", label: "Ганаш тёмный", height: 1 },
        { type: "chocolate", color: "#3d2817", label: "Шоколадный бисквит", height: 3 },
      ],
      coating: { color: "#1a0d08", label: "Ганаш" },
      decoration: { type: "chocolate", color: "#3d2817" },
      shape: "round",
    };
  }
  if (text.includes("ванил") || text.includes("vanilla")) {
    return {
      layers: [
        { type: "biscuit", color: "#f4e4c1", label: "Ванильный бисквит", height: 3 },
        { type: "cream", color: "#fffaeb", label: "Крем маскарпоне", height: 1 },
        { type: "biscuit", color: "#f4e4c1", label: "Ванильный бисквит", height: 3 },
      ],
      coating: { color: "#fffaeb", label: "Крем-чиз" },
      decoration: { type: "berries", color: "#dc2626" },
      shape: "round",
    };
  }
  if (text.includes("бархат") || text.includes("velvet")) {
    return {
      layers: [
        { type: "biscuit", color: "#a4161a", label: "Красный бархат", height: 3 },
        { type: "cream", color: "#fffaeb", label: "Сливочный сыр", height: 1 },
        { type: "biscuit", color: "#a4161a", label: "Красный бархат", height: 3 },
      ],
      coating: { color: "#fffaeb", label: "Сливочный сыр" },
      decoration: { type: "sprinkles", color: "#a4161a" },
      shape: "round",
    };
  }
  if (text.includes("ягод") || text.includes("клубник") || text.includes("малин") || text.includes("berry")) {
    return {
      layers: [
        { type: "biscuit", color: "#f4e4c1", label: "Бисквит", height: 3 },
        { type: "berry", color: "#dc2626", label: "Ягодный конфитюр", height: 1 },
        { type: "cream", color: "#fffaeb", label: "Крем-чиз", height: 1 },
        { type: "berry", color: "#dc2626", label: "Свежие ягоды", height: 1 },
      ],
      coating: { color: "#fffaeb", label: "Крем-чиз" },
      decoration: { type: "berries", color: "#dc2626" },
      shape: "round",
    };
  }
  if (text.includes("карамел") || text.includes("caramel")) {
    return {
      layers: [
        { type: "biscuit", color: "#d4a574", label: "Карамельный бисквит", height: 3 },
        { type: "caramel", color: "#92400e", label: "Солёная карамель", height: 1 },
        { type: "cream", color: "#fef3c7", label: "Крем-чиз", height: 2 },
      ],
      coating: { color: "#fef3c7", label: "Крем-чиз" },
      decoration: { type: "nuts", color: "#92400e" },
      shape: "round",
    };
  }

  // Default — используем переданный color если есть
  return {
    layers: [
      { type: "biscuit", color: color || "#f4e4c1", label: "Бисквит", height: 3 },
      { type: "cream", color: "#fffaeb", label: "Крем", height: 2 },
      { type: "biscuit", color: color || "#f4e4c1", label: "Бисквит", height: 3 },
    ],
    coating: { color: "#fffaeb", label: "Крем" },
    shape: "round",
  };
}

const SYSTEM_PROMPT = `Ты — кондитер-дизайнер, помогающий визуализировать срез торта для маркетплейса.
На основе названия и описания начинки сгенерируй JSON-конфигурацию слоёв среза торта.

Требования к слоям:
- 2-5 слоёв (бисквит, крем, начинка, прослойка)
- Каждый слой имеет: type (один из: biscuit, cream, berry, chocolate, mousse, caramel, fruit, nuts), color (hex), label (русское название), height (1-5)
- Цвета должны реалистично отражать ингредиент (шоколад=тёмно-коричневый, ваниль=бежевый, клубника=красный)
- coating — внешний крем/покрытие (color + label)
- decoration — топпинг сверху: type (berries, chocolate, nuts, sprinkles) + color
- shape: "round" (по умолчанию)

Верни ТОЛЬКО валидный JSON в формате:
{
  "layers": [
    { "type": "biscuit", "color": "#f4e4c1", "label": "Ванильный бисквит", "height": 3 },
    { "type": "cream", "color": "#fffaeb", "label": "Крем маскарпоне", "height": 1 }
  ],
  "coating": { "color": "#fffaeb", "label": "Крем-чиз" },
  "decoration": { "type": "berries", "color": "#dc2626" },
  "shape": "round"
}

Без markdown-обёртки, без объяснений, только JSON.`;

export async function POST(request: NextRequest) {
  try {
    const { name, description, consistency, color } = await request.json();

    if (!name) {
      return NextResponse.json({ error: "name обязательно" }, { status: 400 });
    }

    // Пробуем LLM
    let llmConfig: SliceConfig | null = null;
    let explanation = "";

    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();

      const userPrompt = `Сгенерируй срез торта для начинки:
Название: ${name}
Описание: ${description || "—"}
Консистенция: ${consistency || "—"}
Базовый цвет: ${color || "—"}

Верни только JSON-конфигурацию слоёв.`;

      const response = await zai.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        thinking: { type: "disabled" },
      });

      const reply = response.choices?.[0]?.message?.content || "";

      // Извлекаем JSON из ответа (даже если есть markdown-обёртка)
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Валидируем структуру
        if (parsed.layers && Array.isArray(parsed.layers) && parsed.layers.length > 0) {
          llmConfig = {
            layers: parsed.layers.map((l: any) => ({
              type: (["biscuit", "cream", "berry", "chocolate", "mousse", "caramel", "fruit", "nuts"].includes(l.type) ? l.type : "biscuit") as SliceLayer["type"],
              color: typeof l.color === "string" && l.color.startsWith("#") ? l.color : "#f4e4c1",
              label: typeof l.label === "string" ? l.label : "Слой",
              height: Math.min(5, Math.max(1, parseInt(l.height) || 1)),
            })),
            coating: parsed.coating ? {
              color: typeof parsed.coating.color === "string" ? parsed.coating.color : "#fffaeb",
              label: typeof parsed.coating.label === "string" ? parsed.coating.label : "Крем",
            } : undefined,
            decoration: parsed.decoration && ["berries", "chocolate", "nuts", "sprinkles"].includes(parsed.decoration.type) ? {
              type: parsed.decoration.type,
              color: typeof parsed.decoration.color === "string" ? parsed.decoration.color : "#dc2626",
            } : undefined,
            shape: parsed.shape === "square" ? "square" : "round",
          };
          explanation = "Сгенерировано через LLM с учётом описания начинки";
        }
      }
    } catch (llmErr: any) {
      console.warn("[ai-generate-slice] LLM failed:", llmErr?.message || llmErr);
    }

    // Fallback на детерминированный пресет
    if (!llmConfig) {
      llmConfig = detectPreset(name, description, color);
      explanation = "LLM недоступна — использован авто-пресет по названию начинки";
    }

    return NextResponse.json({
      config: llmConfig,
      explanation,
      generatedBy: explanation.includes("LLM") ? "llm" : "preset",
    });
  } catch (error) {
    console.error("[ai-generate-slice] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
