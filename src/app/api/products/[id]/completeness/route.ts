/**
 * GET /api/products/[id]/completeness — Product Completeness Score (Task 2-b).
 *
 * Чеклист заполненности карточки товара (веса в ТЗ суммируются в 110 —
 * score нормируется к 0..100: score = round(100 × Σ(веса выполненных) / Σ(весов))).
 * ready_to_publish = выполнены все required-проверки (title/description/price) —
 * это ТОТ ЖЕ гейт, что и 422 PUBLISH_VALIDATION_FAILED в PATCH
 * /api/products/[id]; publish-логику роут не трогает (только показывает).
 *
 * Права: владелец товара (products.confectioner_id === user.id) или
 * hasAnyRole [ADMIN, SUPER_ADMIN, MODERATOR]. 401 / 403.
 * Несуществующий (или удалённый) товар → 422 PRODUCT_NOT_FOUND (контракт ТЗ;
 * id резолвится как UUID, так и slug).
 *
 * Медиа: считаются только approved product_media (фото/видео).
 *
 * Ответ:
 * {
 *   score: number,               // 0..100
 *   ready_to_publish: boolean,
 *   checks: [{ key, label, done, weight, required }],
 *   approved_photos, approved_videos   // служебные счётчики для UI
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { hasAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProductCompletenessRow = {
  id: string;
  confectioner_id: string | null;
  title: string | null;
  description: string | null;
  short_description: string | null;
  price: number | null;
  category_id: string | null;
  weight_grams: number | null;
  servings: number | null;
  diameter_cm: string | number | null;
  height_cm: string | number | null;
  size_text: string | null;
  filling_description: string | null;
  layers_count: number | null;
  fillings: unknown;
  composition: unknown;
}

interface CompletenessCheck {
  key: string;
  label: string;
  done: boolean;
  weight: number;
  required: boolean;
}

/** Непустая строка после trim. */
function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** jsonb — непустой массив (или объект с ключами). */
function jsonbNonEmptyArray(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v !== null && typeof v === "object") return Object.keys(v).length > 0;
  return false;
}

function compositionObject(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    const pool = getPool();

    // Товар: UUID или slug; удалённый = несуществующий.
    const productResult = await pool.query<ProductCompletenessRow>(
      `SELECT id::text, confectioner_id::text, title, description, short_description,
              price, category_id::text, weight_grams, servings,
              diameter_cm, height_cm, size_text, filling_description,
              layers_count, fillings, composition
       FROM public.products
       WHERE deleted_at IS NULL
         AND (slug = $1 OR (CASE WHEN $2::boolean THEN id = $1::uuid ELSE false END))
       LIMIT 1`,
      [id, UUID_RE.test(id)]
    );
    const product = productResult.rows[0];
    if (!product) {
      // Контракт ТЗ: несуществующий товар → 422 (не 404).
      return NextResponse.json(
        { error: "PRODUCT_NOT_FOUND", message: "Товар не найден" },
        { status: 422 }
      );
    }

    const isOwner =
      product.confectioner_id !== null && product.confectioner_id === user.id;
    if (!isOwner) {
      const canView = await hasAnyRole(user.id, [
        "ADMIN",
        "SUPER_ADMIN",
        "MODERATOR",
      ]);
      if (!canView) {
        return NextResponse.json(
          { error: "FORBIDDEN", message: "Нет доступа к товару" },
          { status: 403 }
        );
      }
    }

    // --- Счётчики approved-медиа ---
    const mediaResult = await pool.query<{ media_type: string; c: number }>(
      `SELECT media_type, count(*)::int AS c
       FROM public.product_media
       WHERE product_id = $1::uuid AND status = 'approved'
       GROUP BY media_type`,
      [product.id]
    );
    const approvedPhotos =
      mediaResult.rows.find((r) => r.media_type === "photo")?.c ?? 0;
    const approvedVideos =
      mediaResult.rows.find((r) => r.media_type === "video")?.c ?? 0;

    // --- Чеклист ---
    const composition = compositionObject(product.composition);
    const ingredientsOk = jsonbNonEmptyArray(composition.ingredients);
    const allergensOk = jsonbNonEmptyArray(composition.allergens);
    const storageOk = nonEmpty(composition.storageConditions);
    const shelfLifeOk = nonEmpty(composition.shelfLife);

    const title = product.title?.trim() ?? "";
    const description = product.description?.trim() ?? "";
    const price = num(product.price);

    const checks: CompletenessCheck[] = [
      {
        key: "title",
        label: "Название",
        done: title.length > 0,
        weight: 10,
        required: true,
      },
      {
        key: "description",
        label: "Описание",
        done: description.length >= 10,
        weight: 10,
        required: true,
      },
      {
        key: "price",
        label: "Цена",
        done: price !== null && price >= 1,
        weight: 10,
        required: true,
      },
      {
        key: "category",
        label: "Категория",
        done: nonEmpty(product.category_id),
        weight: 5,
        required: false,
      },
      {
        key: "short_description",
        label: "Краткое описание",
        done: nonEmpty(product.short_description),
        weight: 5,
        required: false,
      },
      {
        key: "weight",
        label: "Вес",
        done: (num(product.weight_grams) ?? 0) > 0,
        weight: 5,
        required: false,
      },
      {
        key: "servings",
        label: "Порции",
        done: (num(product.servings) ?? 0) > 0,
        weight: 5,
        required: false,
      },
      {
        key: "dimensions",
        label: "Размеры",
        done:
          num(product.diameter_cm) !== null ||
          num(product.height_cm) !== null ||
          nonEmpty(product.size_text),
        weight: 5,
        required: false,
      },
      {
        key: "filling",
        label: "Начинка",
        done:
          nonEmpty(product.filling_description) ||
          (num(product.layers_count) ?? 0) > 0 ||
          jsonbNonEmptyArray(product.fillings),
        weight: 10,
        required: false,
      },
      {
        key: "composition_ingredients",
        label: "Состав: ингредиенты",
        done: ingredientsOk,
        weight: 10,
        required: false,
      },
      {
        key: "composition_allergens",
        label: "Состав: аллергены",
        done: allergensOk,
        weight: 10,
        required: false,
      },
      {
        key: "storage",
        label: "Условия хранения",
        done: storageOk,
        weight: 5,
        required: false,
      },
      {
        key: "shelf_life",
        label: "Срок годности",
        done: shelfLifeOk,
        weight: 5,
        required: false,
      },
      {
        key: "photos",
        label: "Фото",
        done: approvedPhotos >= 1,
        weight: 10,
        required: false,
      },
      {
        key: "video",
        label: "Видео",
        done: approvedVideos >= 1,
        weight: 5,
        required: false,
      },
    ];

    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const earned = checks.reduce((s, c) => s + (c.done ? c.weight : 0), 0);
    const score = totalWeight > 0 ? Math.round((100 * earned) / totalWeight) : 0;
    const readyToPublish = checks
      .filter((c) => c.required)
      .every((c) => c.done);

    return NextResponse.json({
      score,
      ready_to_publish: readyToPublish,
      checks,
      approved_photos: approvedPhotos,
      approved_videos: approvedVideos,
    });
  } catch (err) {
    console.error(
      "[products/completeness] GET failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
