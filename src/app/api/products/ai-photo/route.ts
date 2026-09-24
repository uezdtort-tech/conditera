/**
 * GET  /api/products/ai-photo — список поддерживаемых стилей и размеров
 * POST /api/products/ai-photo — генерация изображения торта через AI
 *
 * POST Body: {
 *   description: string,        // "Шоколадный торт с малиной, 3 яруса, свадебный"
 *   style?: string,             // "modern" | "classic" | "minimalist" | "rustic" | "luxury" | "festive"
 *   size?: string,              // "1024x1024" (default) | "1344x768" | "768x1344" | "1440x720"
 *   productId?: string,         // если указан — сохраняем как image товара
 * }
 *
 * Возвращает: { imageUrl: string, prompt: string, cached: boolean }
 *
 * Сохраняет изображение в /public/uploads/ai-generated/<md5hash>.png
 * Использует MD5-кэш для избежания повторной генерации того же запроса.
 * Fallback на Unsplash stock-photo если AI недоступен.
 *
 * Auth: CONFECTIONER или ADMIN
 *
 * Соответствует таблицам: products (для attachImageToProduct), через z-ai-web-dev-sdk
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";

const OUTPUT_DIR = path.join(process.cwd(), "public", "uploads", "ai-generated");
const PUBLIC_PATH = "/uploads/ai-generated";

const SUPPORTED_SIZES = [
  "1024x1024",  // квадрат (по умолчанию)
  "1344x768",   // landscape
  "768x1344",   // portrait
  "1440x720",   // wide banner
] as const;

interface AiPhotoRequestBody {
  description: string;
  style?: string;
  size?: string;
  productId?: string;
}

/**
 * Стилизация промпта под категорию торта.
 */
function buildCakePrompt(description: string, style?: string): string {
  const stylePrompts: Record<string, string> = {
    modern: "modern minimalist style, clean white background, professional food photography",
    classic: "classic elegant style, soft natural lighting, marble surface, professional food photography",
    minimalist: "minimalist composition, plain background, soft diffused light, high-end food photography",
    rustic: "rustic style, wooden table, natural light, cozy atmosphere, food photography",
    luxury: "luxury presentation, gold accents, dark elegant background, dramatic lighting, premium food photography",
    festive: "festive holiday presentation, decorated table, warm lighting, celebration cake",
  };

  const styleSuffix = style && stylePrompts[style]
    ? stylePrompts[style]
    : "professional food photography, soft natural lighting, high quality, appetizing, detailed";

  return `Professional food photography of a cake: ${description}. ${styleSuffix}. Top-down or 45-degree angle, sharp focus, no text, no watermark, no people.`;
}

/**
 * Прикрепить сгенерированное изображение к товару (если указан productId).
 * Проверяет, что товар принадлежит кондитеру.
 */
async function attachImageToProduct(
  productId: string,
  imageUrl: string,
  userId: string
): Promise<boolean> {
  try {
    // Найти товар с профилем кондитера по user_id
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .select("id, confectioner_id, images")
      .eq("id", productId)
      .maybeSingle();

    if (error || !product) return false;

    // Проверить владение: получить кондитера по confectioner_id и сравнить user_id
    const { data: conf } = await supabaseAdmin
      .from("confectioners")
      .select("user_id")
      .eq("id", product.confectioner_id)
      .maybeSingle();
    if (!conf || conf.user_id !== userId) return false;

    const currentImages = (product.images as string[]) || [];
    if (currentImages.includes(imageUrl)) return true;

    const { error: updateErr } = await supabaseAdmin
      .from("products")
      .update({
        images: [...currentImages, imageUrl],
      })
      .eq("id", productId);

    return !updateErr;
  } catch (e: any) {
    console.warn("[ai-photo] failed to attach to product:", e?.message);
    return false;
  }
}

/**
 * GET /api/products/ai-photo — список поддерживаемых стилей и размеров.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    styles: [
      { id: "modern", label: "Современный", description: "Минимализм, белый фон" },
      { id: "classic", label: "Классический", description: "Мраморная поверхность, мягкий свет" },
      { id: "minimalist", label: "Минимализм", description: "Пустой фон, рассеянный свет" },
      { id: "rustic", label: "Рустикальный", description: "Деревянный стол, уютная атмосфера" },
      { id: "luxury", label: "Люкс", description: "Тёмный фон, золотые акценты, драматичный свет" },
      { id: "festive", label: "Праздничный", description: "Украшенный стол, тёплое освещение" },
    ],
    sizes: SUPPORTED_SIZES.map((s) => ({
      id: s,
      label:
        s === "1024x1024" ? "Квадрат 1:1" :
        s === "1344x768" ? "Альбомная 16:9" :
        s === "768x1344" ? "Портретная 9:16" :
        s === "1440x720" ? "Широкий баннер 2:1" : s,
    })),
  });
}

/**
 * POST /api/products/ai-photo — сгенерировать изображение торта через AI.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — CONFECTIONER или ADMIN
    const guard = await requireAnyRole(user.id, ["CONFECTIONER", "ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = (await request.json()) as AiPhotoRequestBody;
    const { description, style, size = "1024x1024", productId } = body;

    // Валидация description
    if (!description || typeof description !== "string" || description.length < 5) {
      return NextResponse.json(
        { error: "Описание должно быть не менее 5 символов" },
        { status: 400 }
      );
    }
    if (description.length > 500) {
      return NextResponse.json(
        { error: "Описание слишком длинное (макс 500 символов)" },
        { status: 400 }
      );
    }

    // Валидация size
    if (!SUPPORTED_SIZES.includes(size as any)) {
      return NextResponse.json(
        { error: `Неподдерживаемый размер. Допустимо: ${SUPPORTED_SIZES.join(", ")}` },
        { status: 400 }
      );
    }

    // Создать директорию если нет
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Кэш по MD5(description + style + size)
    const cacheKey = crypto
      .createHash("md5")
      .update(`${description}|${style || ""}|${size}`)
      .digest("hex");
    const filename = `${cacheKey}.png`;
    const filepath = path.join(OUTPUT_DIR, filename);
    const imageUrl = `${PUBLIC_PATH}/${filename}`;

    // Если файл уже есть в кэше — возвращаем сразу
    if (fs.existsSync(filepath)) {
      if (productId) {
        await attachImageToProduct(productId, imageUrl, user.id);
      }
      return NextResponse.json({
        imageUrl,
        prompt: buildCakePrompt(description, style),
        cached: true,
      });
    }

    // Генерация через z-ai-web-dev-sdk
    const prompt = buildCakePrompt(description, style);
    try {
      const ZAIModule = await import("z-ai-web-dev-sdk").catch(() => null);
      if (!ZAIModule || !ZAIModule.default) {
        throw new Error("z-ai-web-dev-sdk не установлен или не экспортирует default");
      }
      const ZAI = ZAIModule.default;
      const zai = await ZAI.create();

      // SDK требует строгий тип для size
      const sdkSize = size as "1024x1024" | "1344x768" | "768x1344" | "1440x720" | "864x1152" | "1152x864" | "720x1440";

      const response = await zai.images.generations.create({
        prompt,
        size: sdkSize,
      });

      const imageBase64 = response?.data?.[0]?.base64;
      if (!imageBase64) {
        throw new Error("AI не вернул изображение");
      }

      const buffer = Buffer.from(imageBase64, "base64");
      fs.writeFileSync(filepath, buffer);

      // Опционально сохранить как image товара
      let attached = false;
      if (productId) {
        attached = await attachImageToProduct(productId, imageUrl, user.id);
      }

      return NextResponse.json({
        imageUrl,
        prompt,
        cached: false,
        attachedToProduct: attached,
        fileSize: buffer.length,
      });
    } catch (genErr: any) {
      console.error("[ai-photo] generation failed:", genErr?.message);

      // Fallback — вернуть placeholder из Unsplash
      const fallbackUrl = `https://images.unsplash.com/photo-1535141192574-5d4897c12636?w=1024&q=80&sig=${cacheKey.slice(0, 8)}`;
      return NextResponse.json({
        imageUrl: fallbackUrl,
        prompt,
        cached: false,
        fallback: true,
        error: "AI-генерация недоступна, использован stock-photo",
      });
    }
  } catch (error: any) {
    console.error("[ai-photo] error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
