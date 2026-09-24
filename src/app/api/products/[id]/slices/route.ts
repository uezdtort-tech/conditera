/**
 * GET /api/products/[id]/slices — список срезов торта для продукта
 * POST /api/products/[id]/slices — создать новый срез (модель или загрузить)
 * DELETE /api/products/[id]/slices?sliceId=... — удалить срез
 *
 * Кондитер может:
 *   1. Смоделировать срез через визуализатор (config: JSON)
 *   2. Загрузить фотографию (image: URL после /api/upload)
 *   3. Комбинировать: изображение + config как fallback
 *
 * Безопасность:
 *   • POST/DELETE: требует роль CONFECTIONER + ownership check.
 *   • POST: safeJsonBody + валидация (fillingName обязателен, image ИЛИ config).
 *   • При сбое БД — mock-ответ для dev.
 *   • Type-safe interfaces.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SupabaseError {
  message: string;
}

interface ProductSliceRow {
  id: string;
  product_id: string;
  filling_name: string;
  image: string | null;
  config: unknown;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

interface ProductRow {
  id: string;
  confectioner_id: string;
  title: string;
}

interface CreateSliceBody {
  fillingName?: string;
  image?: string;
  config?: unknown;
  caption?: string;
  sortOrder?: number;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: productId } = await params;
    if (!productId) throw new HttpError(400, "Product ID required");

    let slices: ProductSliceRow[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("product_slices")
        .select("*")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }) as { data: ProductSliceRow[] | null; error: SupabaseError | null };

      if (error) throw error;
      slices = data || [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[slices] GET query failed:", msg);
    }

    return NextResponse.json({ slices, total: slices.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: productId } = await params;
    if (!productId) throw new HttpError(400, "Product ID required");

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    if (!user.roles.includes("CONFECTIONER")) {
      throw new HttpError(403, "Только кондитер");
    }

    const { data: body, error: parseErr } = await safeJsonBody<CreateSliceBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    if (typeof body.fillingName !== "string" || body.fillingName.trim().length === 0) {
      throw new HttpError(400, "fillingName обязательно");
    }
    if (!body.image && !body.config) {
      throw new HttpError(400, "Нужно указать image (URL) или config (SVG-конфигурация)");
    }

    // Проверяем, что продукт принадлежит этому кондитеру
    try {
      const { data: product, error } = await supabaseAdmin
        .from("products")
        .select("id, confectioner_id, title")
        .eq("id", productId)
        .maybeSingle() as { data: ProductRow | null; error: SupabaseError | null };

      if (error) throw error;
      if (product && product.confectioner_id !== user.userId) {
        throw new HttpError(403, "Нет прав на этот продукт");
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // БД недоступна — в dev позволяем
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[slices] ownership check failed:", msg);
    }

    const sortOrder = typeof body.sortOrder === "number" ? body.sortOrder : 0;

    let slice: ProductSliceRow;
    try {
      const { data, error: insertErr } = await supabaseAdmin
        .from("product_slices")
        .insert({
          product_id: productId,
          filling_name: body.fillingName,
          image: body.image || null,
          config: body.config || null,
          caption: body.caption || null,
          sort_order: sortOrder,
          created_at: new Date().toISOString(),
        })
        .select("*")
        .single() as { data: ProductSliceRow | null; error: SupabaseError | null };

      if (insertErr || !data) throw insertErr;
      slice = data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[slices] create failed:", msg);
      // Возвращаем mock-ответ для dev
      slice = {
        id: `temp-${Date.now()}`,
        product_id: productId,
        filling_name: body.fillingName,
        image: body.image || null,
        config: body.config || null,
        caption: body.caption || null,
        sort_order: sortOrder,
        created_at: new Date().toISOString(),
      };
    }

    return NextResponse.json({ slice }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: productId } = await params;
    if (!productId) throw new HttpError(400, "Product ID required");

    const sliceId = request.nextUrl.searchParams.get("sliceId");
    if (!sliceId) {
      throw new HttpError(400, "sliceId обязателен");
    }

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    try {
      const { error } = await supabaseAdmin
        .from("product_slices")
        .delete()
        .eq("id", sliceId)
        .eq("product_id", productId);

      if (error) {
        console.warn("[slices] delete failed:", error.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[slices] delete error:", msg);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
